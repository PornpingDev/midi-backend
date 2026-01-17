// controllers/documentsController.js
const db = require('../db/connection');


// แปลงเลขแสดงผล YY/###
function displayYYSeq(yy, seq) {
  const pad = String(seq || 0).padStart(3, '0');
  return `${yy}/${pad}`;
}


async function nextYYSeq(conn) {
  const thYear = new Date().getFullYear() + 543;
  const yy = thYear % 100;
  const [[row]] = await conn.query(
    'SELECT COALESCE(MAX(sequence),0)+1 AS nextSeq FROM doc_pairs WHERE year_yy=? FOR UPDATE',
    [yy]
  );
  return { year_yy: yy, sequence: row.nextSeq };
}



// GET /api/documents/pairs?from=YYYY-MM-DD&to=YYYY-MM-DD&q=&page=1&limit=20
exports.listPairs = async (req, res) => {
  const { from, to, q, page = 1, limit = 20 } = req.query;
  const params = [];
  let where = '1=1';

  if (from) { where += ' AND COALESCE(inv.invoice_date, dn.delivery_date) >= ?'; params.push(from); }
  if (to)   { where += ' AND COALESCE(inv.invoice_date, dn.delivery_date) <= ?'; params.push(to); }

  if (q && q.trim()) {
    where += ' AND (c.name LIKE ? OR inv.invoice_no LIKE ? OR dn.delivery_note_code LIKE ? OR so.po_number LIKE ?)';
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const offset = (Number(page) - 1) * Number(limit);

  try {
    const [cnt] = await db.query(
      `
      SELECT COUNT(*) AS cnt
      FROM doc_pairs dp
      LEFT JOIN delivery_notes dn ON dn.pair_id = dp.id
      LEFT JOIN invoices inv      ON inv.pair_id = dp.id
      LEFT JOIN sales_orders so   ON so.id = dn.sales_order_id
      LEFT JOIN customers c       ON c.id = IFNULL(dn.customer_id, so.customer_id)
      WHERE ${where}
      `,
      params
    );
    const total = Number(cnt[0]?.cnt || 0);

    const [rows] = await db.query(
      `
      SELECT
        dp.id                         AS pair_id,
        dp.year_yy,
        dp.sequence,
        dp.status                     AS doc_status,
        dn.id                         AS dn_id,
        dn.delivery_note_code         AS dn_no,
        dn.delivery_date              AS dn_date,
        inv.id                        AS inv_id,
        inv.invoice_no                AS inv_no,
        inv.invoice_date              AS inv_date,
        so.po_number                  AS po_number,
        c.name                        AS customer_name,
        COALESCE(inv.grand_total, dn.grand_total) AS grand_total
      FROM doc_pairs dp
      LEFT JOIN delivery_notes dn ON dn.pair_id = dp.id
      LEFT JOIN invoices inv      ON inv.pair_id = dp.id
      LEFT JOIN sales_orders so   ON so.id = dn.sales_order_id
      LEFT JOIN customers c       ON c.id = IFNULL(dn.customer_id, so.customer_id)
      WHERE ${where}
      ORDER BY COALESCE(inv.invoice_date, dn.delivery_date) DESC, dp.id DESC
      LIMIT ? OFFSET ?
      `,
      [...params, Number(limit), offset]
    );

    const items = rows.map(r => ({
      pair_id: r.pair_id,
      display_no: displayYYSeq(r.year_yy, r.sequence),
      doc_status: r.doc_status, // DRAFT/APPROVED/VOID/REPRINT
      customer_name: r.customer_name || null,
      dn:  r.dn_id  ? { id: r.dn_id,  no: r.dn_no,  date: r.dn_date }  : null,
      inv: r.inv_id ? { id: r.inv_id, no: r.inv_no, date: r.inv_date } : null,
      grand_total: Number(r.grand_total || 0),
      po_number: r.po_number || null, 
    }));

    res.json({ ok: true, page: Number(page), limit: Number(limit), total, items });
  } catch (e) {
    console.error('listPairs error', e);
    res.status(500).json({ message: e.message || 'Internal Error' });
  }
};

// GET /api/documents/pairs/:id
exports.getPairDetail = async (req, res) => {
  const pairId = Number(req.params.id || 0);
  if (!pairId) return res.status(400).json({ message: 'pair id ไม่ถูกต้อง' });

  try {
    const [[head]] = await db.query(
      `
      SELECT
        dp.id AS pair_id, dp.year_yy, dp.sequence, dp.status AS doc_status,
        dn.id AS dn_id, dn.delivery_note_code AS dn_no, dn.delivery_date, dn.sales_order_id, dn.customer_id,
        dn.subtotal AS dn_subtotal, dn.vat_rate AS dn_vat_rate, dn.vat_amount AS dn_vat, dn.grand_total AS dn_total,
        inv.id AS inv_id, inv.invoice_no AS inv_no, inv.invoice_date, inv.status AS inv_status,
        inv.subtotal AS inv_subtotal, inv.vat_rate AS inv_vat_rate, inv.vat_amount AS inv_vat, inv.grand_total AS inv_total,
        so.customer_id AS so_customer_id,
        so.po_number AS po_number,
        c.name AS customer_name, c.address, c.tax_id, c.email, c.phone, c.customer_no
      FROM doc_pairs dp
      LEFT JOIN delivery_notes dn ON dn.pair_id = dp.id
      LEFT JOIN invoices inv      ON inv.pair_id = dp.id
      LEFT JOIN sales_orders so   ON so.id = dn.sales_order_id
      LEFT JOIN customers c       ON c.id = IFNULL(dn.customer_id, so.customer_id)
      WHERE dp.id = ?
      `,
      [pairId]
    );
    if (!head) return res.status(404).json({ message: 'ไม่พบเอกสารคู่นี้' });

    const [dnItems] = await db.query(
      `
      SELECT
        dni.id, dni.product_id, p.product_no, p.name AS product_name,
        dni.description, dni.unit, dni.quantity_delivered AS quantity,
        dni.unit_price, dni.line_amount
      FROM delivery_note_items dni
      JOIN delivery_notes dn ON dn.id = dni.delivery_note_id
      LEFT JOIN products p ON p.id = dni.product_id
      WHERE dn.pair_id = ?
      ORDER BY dni.id ASC
      `,
      [pairId]
    );

    const [invItems] = await db.query(
      `
      SELECT
        ii.id, ii.product_id, p.product_no, p.name AS product_name,
        ii.description, ii.unit, ii.quantity,
        ii.unit_price, ii.line_amount
      FROM invoice_items ii
      JOIN invoices inv ON inv.id = ii.invoice_id
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE inv.pair_id = ?
      ORDER BY ii.id ASC
      `,
      [pairId]
    );

    res.json({
      ok: true,
      header: {
        pair_id: head.pair_id,
        display_no: displayYYSeq(head.year_yy, head.sequence),
        doc_status: head.doc_status,
        po_number: head.po_number || null, 
        customer: {
          id: head.customer_id || head.so_customer_id || null,
          name: head.customer_name || null,
          address: head.address || null,
          tax_id: head.tax_id || null,
          email: head.email || null,
          phone: head.phone || null,
          customer_no: head.customer_no || null,
        },
        dn: {
          id: head.dn_id, no: head.dn_no, date: head.delivery_date,
          subtotal: Number(head.dn_subtotal || 0),
          vat_rate: Number(head.dn_vat_rate || 0),
          vat_amount: Number(head.dn_vat || 0),
          grand_total: Number(head.dn_total || 0),
        },
        inv: {
          id: head.inv_id, no: head.inv_no, date: head.invoice_date,
          status: head.inv_status,
          subtotal: Number(head.inv_subtotal || 0),
          vat_rate: Number(head.inv_vat_rate || 0),
          vat_amount: Number(head.inv_vat || 0),
          grand_total: Number(head.inv_total || 0),
        }
      },
      items: {
        dn: dnItems.map(x => ({
          id: x.id, product_id: x.product_id, product_no: x.product_no,
          name: x.product_name, description: x.description, unit: x.unit,
          quantity: Number(x.quantity), unit_price: Number(x.unit_price || 0),
          line_amount: Number(x.line_amount || 0),
        })),
        inv: invItems.map(x => ({
          id: x.id, product_id: x.product_id, product_no: x.product_no,
          name: x.product_name, description: x.description, unit: x.unit,
          quantity: Number(x.quantity), unit_price: Number(x.unit_price || 0),
          line_amount: Number(x.line_amount || 0),
        }))
      }
    });
  } catch (e) {
    console.error('getPairDetail error', e);
    res.status(500).json({ message: e.message || 'Internal Error' });
  }
};

// GET /api/documents/pairs/:id/print?form=A|B&labels=DN,INV,BILL
exports.printPair = async (req, res) => {
  const pairId = Number(req.params.id || 0);
  const form = String(req.query.form || 'A').toUpperCase();
  if (!pairId) return res.status(400).json({ message: 'pair id ไม่ถูกต้อง' });
  if (!['A','B'].includes(form)) return res.status(400).json({ message: 'form ต้องเป็น A หรือ B' });

  // ✅ รองรับ labels ทั้ง A และ B (ไม่จำค่า)
  // A: DN=ใบส่งของ, INV=ใบแจ้งหนี้, BILL=ใบวางบิล
  // B: TAX=ใบกำกับภาษี, RCPT=ใบเสร็จรับเงิน
  let header_title = null;
  let header_labels = null;

  const MAP_A = { DN: 'ใบส่งของ', INV: 'ใบแจ้งหนี้', BILL: 'ใบวางบิล' };
  const MAP_B = { TAX: 'ใบกำกับภาษี', RCPT: 'ใบเสร็จรับเงิน' };
  const MAP = form === 'A' ? MAP_A : MAP_B;

  const raw = req.query.labels ? String(req.query.labels) : '';
  // ถ้าส่ง labels มา → กรองเฉพาะคีย์ที่รองรับ, ถ้าไม่ส่งเลย → ใช้ทุกคีย์ของฟอร์มนั้น
  const picked = raw
    ? raw.split(',').map(s => s.trim().toUpperCase()).filter(k => MAP[k])
    : Object.keys(MAP);

  header_labels = picked.length ? picked : Object.keys(MAP);     // เช่น ['DN','INV'] หรือ ['TAX','RCPT']
  header_title  = header_labels.map(k => MAP[k]).join('/');      // เช่น "ใบส่งของ/ใบแจ้งหนี้"

  try {
    const [[h]] = await db.query(
      `
      SELECT
        dp.id AS pair_id, dp.year_yy, dp.sequence, dp.status AS doc_status,
        dn.id AS dn_id, dn.delivery_note_code AS dn_no, dn.delivery_date,
        dn.subtotal AS dn_subtotal, dn.vat_rate AS dn_vat_rate, dn.vat_amount AS dn_vat, dn.grand_total AS dn_total,
        inv.id AS inv_id, inv.invoice_no AS inv_no, inv.invoice_date,
        inv.subtotal AS inv_subtotal, inv.vat_rate AS inv_vat_rate, inv.vat_amount AS inv_vat, inv.grand_total AS inv_total,
        so.sales_order_no,
        so.po_number,
        c.name AS customer_name, c.address, c.tax_id, c.email, c.phone, c.customer_no
      FROM doc_pairs dp
      LEFT JOIN delivery_notes dn ON dn.pair_id = dp.id
      LEFT JOIN invoices inv      ON inv.pair_id = dp.id
      LEFT JOIN sales_orders so   ON so.id = dn.sales_order_id
      LEFT JOIN customers c       ON c.id = IFNULL(dn.customer_id, so.customer_id)
      WHERE dp.id = ?
      `,
      [pairId]
    );
    if (!h) return res.status(404).json({ message: 'ไม่พบเอกสารคู่นี้' });

    const [items] = await db.query(
      `
      SELECT
        ii.id, ii.product_id, p.product_no, p.name AS product_name,
        COALESCE(ii.description, p.name) AS description,
        ii.unit, ii.quantity, ii.unit_price, ii.line_amount
      FROM invoice_items ii
      JOIN invoices inv ON inv.id = ii.invoice_id
      LEFT JOIN products p ON p.id = ii.product_id
      WHERE inv.pair_id = ?
      ORDER BY ii.id ASC
      `,
      [pairId]
    );

    res.json({
      ok: true,
      form,                                    // 'A' หรือ 'B'
      header_title,                            // ✅ ใช้แสดงหัวเอกสารสำหรับ A-Form
      header_labels,                           // ✅ ['DN','INV','BILL'] ที่ใช้จริง
      pair_id: h.pair_id,
      display_no: displayYYSeq(h.year_yy, h.sequence),
      doc_status: h.doc_status,
      customer: {
        name: h.customer_name, address: h.address, tax_id: h.tax_id,
        email: h.email, phone: h.phone, customer_no: h.customer_no,
      },
      sales_order_no: h.sales_order_no,
      po_number: h.po_number || null,
      document_no: form === 'A' ? (h.dn_no || h.inv_no) : (h.inv_no || h.dn_no),
      document_date: form === 'A' ? (h.delivery_date || h.invoice_date) : (h.invoice_date || h.delivery_date),
      totals: {
        subtotal: Number(h.inv_subtotal ?? h.dn_subtotal ?? 0),
        vat_rate: Number(h.inv_vat_rate ?? h.dn_vat_rate ?? 7),
        vat_amount: Number(h.inv_vat ?? h.dn_vat ?? 0),
        grand_total: Number(h.inv_total ?? h.dn_total ?? 0),
      },
      items: items.map(x => ({
        product_no: x.product_no,
        name: x.product_name,
        description: x.description,
        unit: x.unit,
        quantity: Number(x.quantity),
        unit_price: Number(x.unit_price || 0),
        line_amount: Number(x.line_amount || 0),
      })),
    });
  } catch (e) {
    console.error('printPair error', e);
    res.status(500).json({ message: e.message || 'Internal Error' });
  }
};


// POST /api/documents/pairs/:id/reprint
exports.reprintPair = async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ message: 'pair id ไม่ถูกต้อง' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[dp]] = await conn.query('SELECT id, status FROM doc_pairs WHERE id=? FOR UPDATE', [id]);
    if (!dp) throw new Error('ไม่พบเอกสารคู่นี้');

    await conn.query(`UPDATE doc_pairs SET status='REPRINT' WHERE id=?`, [id]);

    await conn.commit();
    res.json({ ok: true, message: 'ทำเครื่องหมาย REPRINT แล้ว' });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ message: e.message || 'ไม่สำเร็จ' });
  } finally {
    conn.release();
  }
};

// POST /api/documents/pairs/:id/void   (admin only)
exports.voidPair = async (req, res) => {
  const id = Number(req.params.id || 0);
  if (!id) return res.status(400).json({ message: 'pair id ไม่ถูกต้อง' });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[dp]] = await conn.query('SELECT id, status FROM doc_pairs WHERE id=? FOR UPDATE', [id]);
    if (!dp) throw new Error('ไม่พบเอกสารคู่นี้');
    if (dp.status === 'VOID') throw new Error('เอกสารถูก VOID แล้ว');

    await conn.query(`UPDATE doc_pairs SET status='VOID' WHERE id=?`, [id]);
    await conn.query(`UPDATE invoices SET status='cancelled', updated_at=NOW() WHERE pair_id=?`, [id]);

    await conn.commit();
    res.json({ ok: true, message: 'VOID คู่เอกสารเรียบร้อย' });
  } catch (e) {
    await conn.rollback();
    res.status(400).json({ message: e.message || 'ไม่สำเร็จ' });
  } finally {
    conn.release();
  }
};

