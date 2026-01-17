// controllers/manualController.js
const db = require('../db/connection');

/* ========= Helpers ========= */

function buddhistYearYY() {
  const be = new Date().getFullYear() + 543;
  return { beYear: be, yy: String(be).slice(-2) };
}

function pad3(n) {
  return String(n).padStart(3, '0');
}

// รับได้ทั้ง 'YYYY-MM-DD' หรือ 'DD-MM-YYYY' (หรือมี '/' ก็ได้) → คืน 'YYYY-MM-DD' หรือ null
function toISODateOrNull(input) {
  if (!input) return null;
  if (typeof input === 'string') {
    const s = input.trim();
    // YYYY-MM-DD หรือ YYYY/MM/DD
    let m = s.match(/^(\d{4})[-\/](\d{2})[-\/](\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    // DD-MM-YYYY หรือ DD/MM/YYYY
    m = s.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}


/** จองเลข MQ/MPO สำหรับ QUOTATION/PO (รันทันทีตอนสร้าง DRAFT) */
async function nextManualCounter(conn, kind) {
  // kind: 'QUOTATION' | 'PO'
  const { beYear, yy } = buddhistYearYY();
  const prefix = kind === 'QUOTATION' ? 'MQ' : 'MPO';

  // seed/update counter atomically; re-fetch prefix (in case changed)
  await conn.query(
    `
    INSERT INTO manual_counters (be_year, kind, prefix, last_seq)
    VALUES (?, ?, ?, 0)
    ON DUPLICATE KEY UPDATE
      last_seq = LAST_INSERT_ID(last_seq + 1),
      prefix   = VALUES(prefix)
    `,
    [beYear, kind, prefix]
  );
  const [[ctr]] = await conn.query(
    `SELECT LAST_INSERT_ID() AS next_seq`
  );
  const nextSeq = Number(ctr.next_seq || 1);
  const no = `${prefix}${yy}-${pad3(nextSeq)}`;
  return { beYear, yy, nextSeq, no, prefix };
}

/** จองเลขกลางจาก doc_pairs (เหมือน AUTO) สำหรับ A/B ตอนอนุมัติ */
async function nextDocPair(conn) {
  const { beYear, yy } = buddhistYearYY();

  // หา sequence ล่าสุดด้วย FOR UPDATE กันชนกัน
  const [[row]] = await conn.query(
    `SELECT sequence FROM doc_pairs WHERE be_year=? ORDER BY sequence DESC LIMIT 1 FOR UPDATE`,
    [beYear]
  );
  const nextSeq = (row?.sequence || 0) + 1;

  const [ins] = await conn.query(
    `INSERT INTO doc_pairs (be_year, year_yy, sequence, status)
     VALUES (?,?,?, 'APPROVED')`,
    [beYear, yy, nextSeq]
  );
  const pairId = ins.insertId;
  return { beYear, yy, nextSeq, pairId, displayNo: `${yy}/${pad3(nextSeq)}` };
}


exports.createDraft = async (req, res) => {
  const {
    doc_kind,
    customer_id = null,
    supplier_id = null,
    party_name = null,
    party_address = null,
    party_tax_id = null,
    party_email = null,
    party_phone = null,
    doc_date = null,
    note = null,
    vat_rate = 7,
    items = [],
    po_number = null,
    customer_no = null,
  } = req.body || {};

  if (!['QUOTATION', 'PO', 'A', 'B'].includes(doc_kind)) {
    return res.status(400).json({ message: 'doc_kind ต้องเป็น QUOTATION | PO | A | B' });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // คำนวณยอดรวมจาก items
    const normItems = Array.isArray(items) ? items : [];
    let subtotal = 0;
    for (const it of normItems) {
      const qty = Number(it.quantity || 0);
      const price = Number(it.unit_price || 0);
      subtotal += qty * price;
    }
    const vatRate = Number(vat_rate || 0);
    const vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;
    const grandTotal = subtotal + vatAmount;

    // เตรียมคอลัมน์เลข
    let quotation_no = null;
    let po_no = null;
    let display_no = null;

    let custNo = typeof customer_no === 'string' ? customer_no.trim() : null;
    if (!custNo && customer_id) {
      const [[c]] = await conn.query('SELECT customer_no FROM customers WHERE id=?', [customer_id]);
      custNo = c?.customer_no || null;
    }

/*
    if (doc_kind === 'QUOTATION' || doc_kind === 'PO') {
      const { no } = await nextManualCounter(conn, doc_kind);
      if (doc_kind === 'QUOTATION') {
        quotation_no = no;
        display_no = no;
      } else {
        po_no = no;
        display_no = no;
      }
    }

*/
    const docDateISO = toISODateOrNull(doc_date);



    const [ms] = await conn.query(
      `INSERT INTO manual_sets
        (doc_kind, status, pair_id, display_no,
         mdn_no, inv_no, quotation_no, po_no,
         customer_id, customer_no, supplier_id,
         party_name, party_address, party_tax_id, party_email, party_phone,
         doc_date, note,
         subtotal, vat_rate, vat_amount, grand_total, po_number)
       VALUES
        ( ?, 'DRAFT', NULL, ?,
          NULL, NULL, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          COALESCE(?, CURRENT_DATE), ?,
          ?, ?, ?, ? ,
          ?)`,
          
      [
        doc_kind, display_no,
        quotation_no, po_no,
        customer_id, custNo, supplier_id,
        party_name, party_address, party_tax_id, party_email, party_phone,
        docDateISO,
        note,
        subtotal, vatRate, vatAmount, grandTotal,
        po_number,
      ]
    );
    const manualSetId = ms.insertId;

    // บันทึกรายการ (ถ้ามี)
    for (const it of normItems) {
      const qty = Number(it.quantity || 0);
      const price = Number(it.unit_price || 0);
      const amt = qty * price;
      await conn.query(
        `INSERT INTO manual_items
           (manual_set_id, product_id, description, unit, quantity, unit_price, line_amount)
         VALUES (?,?,?,?,?,?,?)`,
        [
          manualSetId,
          it.product_id || null,
          it.description || '',
          it.unit || 'ชิ้น',
          qty, price, amt
        ]
      );
    }

    await conn.commit();
    res.json({
      ok: true,
      id: manualSetId,
      doc_kind,
      display_no,
      quotation_no,
      po_no,
      status: 'DRAFT'
    });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ message: e.message || 'ไม่สำเร็จ' });
  } finally {
    conn.release();
  }
};



exports.approveManual = async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[h]] = await conn.query(
      `SELECT id, doc_kind, status FROM manual_sets WHERE id=? FOR UPDATE`,
      [id]
    );
    if (!h) throw new Error('ไม่พบเอกสาร');
    if (h.status !== 'DRAFT') throw new Error('อนุมัติได้เฉพาะสถานะ DRAFT');

    let updates = {};
    if (h.doc_kind === 'A' || h.doc_kind === 'B') {
      // จองเลขกลางร่วมกับ AUTO
      const { yy, nextSeq, pairId, displayNo } = await nextDocPair(conn);
      const seq3 = pad3(nextSeq);
      const mdn = `MDN${yy}-${seq3}`;
      const minv = `MINV${yy}-${seq3}`;

      updates = {
        pair_id: pairId,
        display_no: displayNo,
        mdn_no: h.doc_kind === 'A' ? mdn : null,
        inv_no: minv
      };

      await conn.query(
        `UPDATE manual_sets
           SET pair_id=?, display_no=?,
               mdn_no=?, inv_no=?,
               status='APPROVED'
         WHERE id=?`,
        [updates.pair_id, updates.display_no, updates.mdn_no, updates.inv_no, id]
      );
    } else if (h.doc_kind === 'QUOTATION' || h.doc_kind === 'PO') {
      // QUOTATION / PO: lazy numbering → ออกเลขตอนอนุมัติ
      const { no } = await nextManualCounter(conn, h.doc_kind);
      const sets = [];
      const params = [];
      if (h.doc_kind === 'QUOTATION') {
        sets.push('quotation_no=?', 'display_no=?');
        params.push(no, no);
      } else {
        sets.push('po_no=?', 'display_no=?');
        params.push(no, no);
      }
      sets.push(`status='APPROVED'`);

      await conn.query(
        `UPDATE manual_sets SET ${sets.join(', ')} WHERE id=?`,
        [...params, id]
      );
    } else {
      // กันกรณี doc_kind แปลก ๆ
      await conn.query(`UPDATE manual_sets SET status='APPROVED' WHERE id=?`, [id]);
    }


    await conn.commit();
    res.json({ ok: true, id, status: 'APPROVED', ...updates });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ message: e.message || 'ไม่สำเร็จ' });
  } finally {
    conn.release();
  }
};

/**
 * GET /api/manual/:id
 * อ่านรายละเอียดหัว+รายการ
 */
exports.getManual = async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });
  try {
    const [[head]] = await db.query(
      `
      SELECT
        ms.id, ms.doc_kind, ms.status, ms.display_no,
        ms.quotation_no, ms.po_no, ms.mdn_no, ms.inv_no,
        ms.customer_id, ms.customer_no, ms.supplier_id,
        ms.party_name, ms.party_address, ms.party_tax_id, ms.party_email, ms.party_phone,
        ms.po_number,
        DATE_FORMAT(ms.doc_date, '%Y-%m-%d') AS doc_date,            
        DATE_FORMAT(ms.doc_date, '%d-%m-%Y') AS doc_date_dmy,        
        DATE_FORMAT(DATE_ADD(ms.doc_date, INTERVAL 543 YEAR), '%d-%m-%Y') AS doc_date_th, 
        ms.note,
        ms.subtotal, ms.vat_rate, ms.vat_amount, ms.grand_total
      FROM manual_sets ms
      WHERE ms.id=?
      `,
      [id]
    );
    if (!head) return res.status(404).json({ message: 'ไม่พบเอกสาร' });

    const [lines] = await db.query(
      `SELECT * FROM manual_items WHERE manual_set_id=? ORDER BY id ASC`,
      [id]
    );
    res.json({ ok: true, header: head, items: lines });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Internal Error' });
  }
};


/**
 * PUT /api/manual/:id
 * แก้ไขหัว DRAFT (A/B/MQ/MPO)
 * - ถ้า APPROVED/VOID → ไม่อนุญาต
 */
exports.updateManualHeader = async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });

  const allowCols = [
    'customer_id','supplier_id',
    'party_name','party_address','party_tax_id','party_email','party_phone',
    'doc_date','note','vat_rate',
    'po_number',
    'subtotal','vat_amount','grand_total',
    'customer_no', 
  ];
  const setParts = [];
  const params = [];

  // จัดการ customer_id / customer_no 
  if ('customer_id' in req.body || 'customer_no' in req.body) {
    // จะอัปเดตเฉพาะฟิลด์ที่ส่งมาเท่านั้น (ไม่เผลอ set NULL)
    let newIdDefined = false, newId = null;
    let newNoDefined = false, newNo = null;

    if ('customer_id' in req.body) {
      newIdDefined = true;
      newId = req.body.customer_id || null;
    }
    if ('customer_no' in req.body) {
      newNoDefined = true;
      newNo = (req.body.customer_no ?? null);
    }

    // ถ้าส่ง customer_id มาแต่ไม่ส่ง customer_no → เติมจากตาราง customers ให้อัตโนมัติ
    if (newIdDefined && !newNoDefined && newId) {
      const [[c]] = await db.query('SELECT customer_no FROM customers WHERE id=?', [newId]);
      newNoDefined = true;
      newNo = c?.customer_no || null;
    }

    if (newIdDefined) { setParts.push(`customer_id=?`); params.push(newId); }
    if (newNoDefined) { setParts.push(`customer_no=?`); params.push(newNo); }
  }



  for (const c of allowCols) {
    if (c === 'customer_id' || c === 'customer_no') continue; // << กันซ้ำ
    if (c in req.body) {
      if (c === 'doc_date') {
        const iso = toISODateOrNull(req.body.doc_date);
        if (!iso) return res.status(400).json({ message: 'รูปแบบวันที่ไม่ถูกต้อง' });
        setParts.push(`doc_date=?`);
        params.push(iso);
      } else {
        setParts.push(`${c}=?`);
        params.push(req.body[c]);
      }
    }
  }
  if (!setParts.length) return res.status(400).json({ message: 'ไม่มีข้อมูลให้แก้ไข' });

  try {
    const [[h]] = await db.query(`SELECT status FROM manual_sets WHERE id=?`, [id]);
    if (!h) return res.status(404).json({ message: 'ไม่พบเอกสาร' });
    if (h.status !== 'DRAFT') return res.status(400).json({ message: 'แก้ไขได้เฉพาะ DRAFT' });

    await db.query(`UPDATE manual_sets SET ${setParts.join(', ')} WHERE id=?`, [...params, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ message: e.message || 'ไม่สำเร็จ' });
  }
};

/**
 * PUT /api/manual/:id/items
 * แทนรายการใหม่ทั้งชุด (เฉพาะ DRAFT)
 * body: items: [{product_id?, description, unit?, quantity, unit_price}]
 * คำนวณ subtotal/vat/grand_total และอัปเดต header ให้ด้วย
 */
exports.replaceItems = async (req, res) => {
  const id = Number(req.params.id || 0);
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!id) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[h]] = await conn.query(`SELECT status, vat_rate FROM manual_sets WHERE id=? FOR UPDATE`, [id]);
    if (!h) throw new Error('ไม่พบเอกสาร');
    if (h.status !== 'DRAFT') throw new Error('แก้ไขได้เฉพาะ DRAFT');

    await conn.query(`DELETE FROM manual_items WHERE manual_set_id=?`, [id]);

    let subtotal = 0;
    for (const it of items) {
      const qty = Number(it.quantity || 0);
      const price = Number(it.unit_price || 0);
      const amt = qty * price;
      subtotal += amt;
      await conn.query(
        `INSERT INTO manual_items
           (manual_set_id, product_id, description, unit, quantity, unit_price, line_amount)
         VALUES (?,?,?,?,?,?,?)`,
        [id, it.product_id || null, it.description || '', it.unit || 'ชิ้น', qty, price, amt]
      );
    }
    const vatRate = Number(h.vat_rate || 0);
    const vatAmount = Math.round(subtotal * (vatRate / 100) * 100) / 100;
    const grandTotal = subtotal + vatAmount;

    await conn.query(
      `UPDATE manual_sets SET subtotal=?, vat_amount=?, grand_total=? WHERE id=?`,
      [subtotal, vatAmount, grandTotal, id]
    );

    await conn.commit();
    res.json({ ok: true, subtotal, vat_rate: vatRate, vat_amount: vatAmount, grand_total: grandTotal });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ message: e.message || 'ไม่สำเร็จ' });
  } finally {
    conn.release();
  }
};

/**
 * POST /api/manual/:id/void   (admin only ตาม RBAC ของโปรเจกต์)
 */
exports.voidManual = async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });
  try {
    const [[h]] = await db.query(`SELECT status FROM manual_sets WHERE id=?`, [id]);
    if (!h) return res.status(404).json({ message: 'ไม่พบเอกสาร' });
    if (h.status === 'VOID') return res.status(400).json({ message: 'เอกสารถูก VOID แล้ว' });

    await db.query(`UPDATE manual_sets SET status='VOID' WHERE id=?`, [id]);
    res.json({ ok: true, status: 'VOID' });
  } catch (e) {
    res.status(400).json({ message: e.message || 'ไม่สำเร็จ' });
  }
};

/**
 * POST /api/manual/:id/duplicate
 * ทำสำเนาจากเอกสาร (อนุมัติหรือ draft ก็ได้) → กลายเป็น DRAFT ใหม่ (ไม่ยกเลข)
 */
exports.duplicateManual = async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[h]] = await conn.query(`SELECT * FROM manual_sets WHERE id=?`, [id]);
    if (!h) throw new Error('ไม่พบเอกสาร');

    // header ใหม่ (ล้างเลข/คู่เลข + สถานะกลับ DRAFT)
    const [ins] = await conn.query(
      `INSERT INTO manual_sets
       (doc_kind, status, pair_id, display_no, mdn_no, inv_no, quotation_no, po_no,
        customer_id, customer_no, supplier_id, party_name, party_address, party_tax_id, party_email, party_phone,
        doc_date, note, subtotal, vat_rate, vat_amount, grand_total,
        po_number)
       VALUES
       ( ?, 'DRAFT', NULL, NULL, NULL, NULL, NULL, NULL,
         ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?,
         ? )`,
      [
        h.doc_kind,
        h.customer_id, h.customer_no, h.supplier_id, h.party_name, h.party_address, h.party_tax_id, h.party_email, h.party_phone,
        h.doc_date, h.note, h.subtotal, h.vat_rate, h.vat_amount, h.grand_total,
        h.po_number,
      ]
    );
    const newId = ins.insertId;

    const [lines] = await conn.query(`SELECT * FROM manual_items WHERE manual_set_id=? ORDER BY id`, [id]);
    for (const ln of lines) {
      await conn.query(
        `INSERT INTO manual_items
          (manual_set_id, product_id, description, unit, quantity, unit_price, line_amount)
         VALUES (?,?,?,?,?,?,?)`,
        [newId, ln.product_id, ln.description, ln.unit, ln.quantity, ln.unit_price, ln.line_amount]
      );
    }

    await conn.commit();
    res.json({ ok: true, id: newId, status: 'DRAFT' });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ message: e.message || 'ไม่สำเร็จ' });
  } finally {
    conn.release();
  }
};

/**
 * GET /api/manual/list?q=&kind=&status=&page=&limit=
 * ลิสต์เฉพาะเอกสาร Manual (ไม่รวม Auto)
 */
exports.listManual = async (req, res) => {
  const { q = '', kind = '', status = '', page = 1, limit = 20 } = req.query || {};
  const params = [];
  let where = '1=1';

  if (kind && ['A','B','QUOTATION','PO'].includes(kind)) {
    where += ' AND ms.doc_kind = ?'; params.push(kind);
  }
  if (status && ['DRAFT','APPROVED','VOID'].includes(status)) {
    where += ' AND ms.status = ?'; params.push(status);
  }
  if (q && q.trim()) {
    where += ` AND (
      ms.display_no LIKE ? OR ms.quotation_no LIKE ? OR ms.po_no LIKE ?
      OR ms.mdn_no LIKE ? OR ms.inv_no LIKE ?
      OR ms.party_name LIKE ?
      OR ms.po_number LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like);
  }

  const offset = (Number(page) - 1) * Number(limit);

  try {
    const [[cnt]] = await db.query(
      `SELECT COUNT(*) AS cnt FROM manual_sets ms WHERE ${where}`, params
    );
    const total = Number(cnt.cnt || 0);

    const [rows] = await db.query(
      `
      SELECT
         ms.id, ms.doc_kind, ms.status,
         ms.display_no, ms.quotation_no, ms.po_no, ms.mdn_no, ms.inv_no,
         DATE_FORMAT(ms.doc_date, '%Y-%m-%d') AS doc_date,
         DATE_FORMAT(ms.doc_date, '%d-%m-%Y') AS doc_date_dmy,
         DATE_FORMAT(DATE_ADD(ms.doc_date, INTERVAL 543 YEAR), '%d-%m-%Y') AS doc_date_th,
         ms.grand_total, ms.party_name,
         ms.po_number
       FROM manual_sets ms
       WHERE ${where}
       ORDER BY ms.doc_date DESC, ms.id DESC
       LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), offset]
    );

    res.json({ ok: true, page: Number(page), limit: Number(limit), total, items: rows });
  } catch (e) {
    res.status(500).json({ message: e.message || 'Internal Error' });
  }
};


/* 07.09.25
// GET /api/manual/:id/print?labels=...   (A: DN,INV,BILL  |  B: TAX,RCPT)
exports.manualPrint = async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });

  const conn = await db.getConnection();
  try {
    const [[h]] = await conn.query(
      `
      SELECT
        ms.id, ms.doc_kind, ms.status, ms.display_no,
        ms.mdn_no, ms.inv_no, ms.quotation_no, ms.po_no,
        ms.doc_date, ms.note,
        ms.party_name, ms.party_address, ms.party_tax_id, ms.party_email, ms.party_phone,
        ms.subtotal, ms.vat_rate, ms.vat_amount, ms.grand_total,
        ms.pair_id,
        ms.po_number
      FROM manual_sets ms
      WHERE ms.id=?
      `,
      [id]
    );
    if (!h) return res.status(404).json({ message: 'ไม่พบเอกสาร' });

    const [items] = await conn.query(
      `
      SELECT
        mi.id, mi.product_id, p.product_no, p.name AS product_name,
        COALESCE(mi.description, p.name) AS description,
        mi.unit, mi.quantity, mi.unit_price, mi.line_amount
      FROM manual_items mi
      LEFT JOIN products p ON p.id = mi.product_id
      WHERE mi.manual_set_id=?
      ORDER BY mi.id ASC
      `,
      [id]
    );

    // กำหนดหัวเอกสาร/labels
    const kind = h.doc_kind;  // 'A'|'B'|'QUOTATION'|'PO'
    let header_title = null;
    let header_labels = [];

    if (kind === 'A') {
      const MAP = { DN: 'ใบส่งของ', INV: 'ใบแจ้งหนี้', BILL: 'ใบวางบิล' };
      const raw = String(req.query.labels || '');
      const picked = raw
        ? raw.split(',').map(v => v.trim().toUpperCase()).filter(k => MAP[k])
        : Object.keys(MAP);
      header_labels = picked.length ? picked : Object.keys(MAP);
      header_title  = header_labels.map(k => MAP[k]).join('/');
    } else if (kind === 'B') {
      const MAP = { TAX: 'ใบกำกับภาษี', RCPT: 'ใบเสร็จรับเงิน' };
      const raw = String(req.query.labels || '');
      const picked = raw
        ? raw.split(',').map(v => v.trim().toUpperCase()).filter(k => MAP[k])
        : Object.keys(MAP);
      header_labels = picked.length ? picked : Object.keys(MAP);
      header_title  = header_labels.map(k => MAP[k]).join('/');
    } else if (kind === 'QUOTATION') {
      header_title = 'ใบเสนอราคา';
      header_labels = ['QUOTATION'];
    } else if (kind === 'PO') {
      header_title = 'ใบสั่งซื้อ';
      header_labels = ['PO'];
    }

    res.json({
      ok: true,
      form: kind,
      header_title,
      header_labels,
      manual_id: h.id,
      display_no: h.display_no || h.quotation_no || h.po_no,
      doc_status: h.status,
      po_number: h.po_number || null,
      party: {
        name: h.party_name, address: h.party_address, tax_id: h.party_tax_id,
        email: h.party_email, phone: h.party_phone,
      },
      document_no: h.quotation_no || h.po_no || h.mdn_no || h.inv_no || h.display_no,
      document_date: h.doc_date,
      totals: {
        subtotal: Number(h.subtotal || 0),
        vat_rate: Number(h.vat_rate || 0),
        vat_amount: Number(h.vat_amount || 0),
        grand_total: Number(h.grand_total || 0),
      },
      items: items.map(x => ({
        product_no: x.product_no,
        name: x.product_name,
        description: (x.description || '').replace(/\r?\n/g, '<br/>'),
        unit: x.unit,
        quantity: Number(x.quantity),
        unit_price: Number(x.unit_price || 0),
        line_amount: Number(x.line_amount || 0),
      })),
    });
  } catch (e) {
    console.error('manualPrint error', e);
    res.status(500).json({ message: e.message || 'Internal Error' });
  } finally {
    conn.release();
  }
};
*/


// GET /api/manual/:id/print?labels=...   (A: DN,INV,BILL  |  B: TAX,RCPT)
exports.manualPrint = async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ message: 'id ไม่ถูกต้อง' });

  const conn = await db.getConnection();
  try {
    const [[h]] = await conn.query(
      `
      SELECT
        ms.id, ms.doc_kind, ms.status, ms.display_no,
        ms.mdn_no, ms.inv_no, ms.quotation_no, ms.po_no,
        ms.doc_date, 
        DATE_FORMAT(ms.doc_date, '%d-%m-%Y') AS doc_date_dmy, 
        DATE_FORMAT(DATE_ADD(ms.doc_date, INTERVAL 543 YEAR), '%d-%m-%Y') AS doc_date_th,
        ms.note,
        ms.party_name, ms.party_address, ms.party_tax_id, ms.party_email, ms.party_phone,
        ms.subtotal, ms.vat_rate, ms.vat_amount, ms.grand_total,
        ms.pair_id,
        ms.po_number,
        COALESCE(ms.customer_no, c.customer_no) AS customer_no 
      FROM manual_sets ms
      LEFT JOIN customers c ON c.id = ms.customer_id
      WHERE ms.id=?
      `,
      [id]
    );
    if (!h) return res.status(404).json({ message: 'ไม่พบเอกสาร' });

    const [items] = await conn.query(
      `
      SELECT
        mi.id, mi.product_id, p.product_no, p.name AS product_name,
        COALESCE(mi.description, p.name) AS description,
        mi.unit, mi.quantity, mi.unit_price, mi.line_amount
      FROM manual_items mi
      LEFT JOIN products p ON p.id = mi.product_id
      WHERE mi.manual_set_id=?
      ORDER BY mi.id ASC
      `,
      [id]
    );

    // กำหนดหัวเอกสาร/labels
    const kind = h.doc_kind;  // 'A'|'B'|'QUOTATION'|'PO'
    let header_title = null;
    let header_labels = [];

    if (kind === 'A') {
      const MAP = { DN: 'ใบส่งของ', INV: 'ใบแจ้งหนี้', BILL: 'ใบวางบิล' };
      const raw = String(req.query.labels || '');
      const picked = raw
        ? raw.split(',').map(v => v.trim().toUpperCase()).filter(k => MAP[k])
        : Object.keys(MAP);
      header_labels = picked.length ? picked : Object.keys(MAP);
      header_title  = header_labels.map(k => MAP[k]).join('/');
    } else if (kind === 'B') {
      const MAP = { TAX: 'ใบกำกับภาษี', RCPT: 'ใบเสร็จรับเงิน' };
      const raw = String(req.query.labels || '');
      const picked = raw
        ? raw.split(',').map(v => v.trim().toUpperCase()).filter(k => MAP[k])
        : Object.keys(MAP);
      header_labels = picked.length ? picked : Object.keys(MAP);
      header_title  = header_labels.map(k => MAP[k]).join('/');
    } else if (kind === 'QUOTATION') {
      header_title = 'ใบเสนอราคา';
      header_labels = ['QUOTATION'];
    } else if (kind === 'PO') {
      header_title = 'ใบสั่งซื้อ';
      header_labels = ['PO'];
    }

    const remarkMain = (h.note || '').toString().replace(/\r?\n/g, '<br/>');

    res.json({
      ok: true,
      form: kind,
      header_title,
      header_labels,
      manual_id: h.id,
      display_no: h.display_no || h.quotation_no || h.po_no,
      doc_status: h.status,
      po_number: h.po_number || null,
      remark: remarkMain,
      party: {
        name: h.party_name, address: h.party_address, tax_id: h.party_tax_id,
        email: h.party_email, phone: h.party_phone, customer_no: h.customer_no || null, 
      },
      document_no: h.quotation_no || h.po_no || h.mdn_no || h.inv_no || h.display_no,
      document_date: h.doc_date,
      doc_date_dmy: h.doc_date_dmy,
      doc_date_th:  h.doc_date_th,
      totals: {
        subtotal: Number(h.subtotal || 0),
        vat_rate: Number(h.vat_rate || 0),
        vat_amount: Number(h.vat_amount || 0),
        grand_total: Number(h.grand_total || 0),
      },
      items: items.map(x => ({
        product_no: x.product_no,
        name: x.product_name,
        description: (x.description || '').replace(/\r?\n/g, '<br/>'),
        unit: x.unit,
        quantity: Number(x.quantity),
        unit_price: Number(x.unit_price || 0),
        line_amount: Number(x.line_amount || 0),
      })),
    });
  } catch (e) {
    console.error('manualPrint error', e);
    res.status(500).json({ message: e.message || 'Internal Error' });
  } finally {
    conn.release();
  }
};