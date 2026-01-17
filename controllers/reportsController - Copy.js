// MIDI-API/controllers/reportsController.js
const db = require("../db/connection");

/**
 * GET /api/reports/stock-balance?search=&low_only=0|1&sort=available_asc
 */
exports.getStockBalance = async (req, res) => {
  try {
    const { search = "", low_only = "0", sort = "available_asc" } = req.query;

    const sortMap = {
      available_asc: "p.available ASC, p.product_no ASC",
      available_desc: "p.available DESC, p.product_no ASC",
      product_no_asc: "p.product_no ASC",
      product_no_desc: "p.product_no DESC",
      product_name_asc: "p.name ASC",
      product_name_desc: "p.name DESC",
    };
    const orderBy = sortMap[sort] || sortMap.available_asc;

    const params = [];
    let where = "WHERE p.is_deleted = 0";

    if (search && search.trim()) {
      const kw = `%${search.trim()}%`;
      where += " AND (p.product_no LIKE ? OR p.name LIKE ?)";
      params.push(kw, kw);
    }
    if (low_only === "1") {
      where += " AND (p.available < p.reorder_point)";
    }

    const sql = `
      SELECT
        p.product_no,
        p.name AS product_name,
        p.stock,
        p.reserved,
        p.available,
        p.reorder_point,
        p.unit
      FROM products p
      ${where}
      ORDER BY ${orderBy}
    `;

    const [rows] = await db.query(sql, params);
    res.json(rows || []);
  } catch (err) {
    console.error("❌ getStockBalance error:", err);
    res.status(500).json({ message: "Server error" });
  }
};


exports.getDeliveryProgress = async (req, res) => {
  try {
    const db = require("../db/connection");
    const { from = "", to = "", search = "", only_open = "1" } = req.query;

    const params = [];
    let where = `
      WHERE soi.is_deleted = 0
        AND so.status <> 'ยกเลิก'
    `;
    if (from) { where += ` AND so.order_date >= ?`; params.push(from); }
    if (to)   { where += ` AND so.order_date <= ?`; params.push(to); }
    if (search && search.trim()) {
      const kw = `%${search.trim()}%`;
      where += ` AND (so.sales_order_no LIKE ? OR p.product_no LIKE ? OR p.name LIKE ?)`;
      params.push(kw, kw, kw);
    }

    // 👇 เพิ่มตารางย่อยรวมยอดจอง (เฉพาะที่ยัง active: is_deleted=0 และ status='จองแล้ว')
    const sql = `
      SELECT
        so.id               AS so_id,
        so.sales_order_no,
        so.customer_id,
        c.customer_no       AS customer_no, 
        c.name              AS customer_name, 
        so.order_date,
        so.required_date,
        soi.id              AS so_item_id,
        soi.product_id,
        p.product_no,
        p.name              AS product_name,

        CAST(soi.quantity AS DECIMAL(12,3))                AS ordered_qty,
        COALESCE(SUM(dni.quantity_delivered), 0)           AS delivered_qty,
        (CAST(soi.quantity AS DECIMAL(12,3)) - COALESCE(SUM(dni.quantity_delivered), 0)) AS remaining_qty,

        COALESCE(r.reserved_qty, 0)                        AS reserved_qty,   -- ✅ เพิ่มคอลัมน์นี้
        MAX(dn.delivery_date)                              AS last_delivery_date

      FROM sales_order_items soi
      JOIN sales_orders so           ON so.id = soi.sales_order_id
      LEFT JOIN customers c          ON c.id = so.customer_id 
      LEFT JOIN products p           ON p.id = soi.product_id

      LEFT JOIN delivery_note_items dni ON dni.sales_order_item_id = soi.id
      LEFT JOIN delivery_notes dn       ON dn.id = dni.delivery_note_id

      LEFT JOIN (
        SELECT
          sales_order_id,
          product_id,
          SUM(quantity_reserved) AS reserved_qty
        FROM stock_reservations
        WHERE is_deleted = 0 AND status = 'จองแล้ว'
        GROUP BY sales_order_id, product_id
      ) r ON r.sales_order_id = so.id AND r.product_id = soi.product_id

      ${where}
      GROUP BY
        so.id, so.sales_order_no, so.customer_id, c.name, so.order_date, so.required_date,
        soi.id, soi.product_id, p.product_no, p.name, soi.quantity, r.reserved_qty

      ${only_open === "1" ? "HAVING remaining_qty > 0" : ""}

      ORDER BY
        so.required_date IS NULL, so.required_date ASC,
        remaining_qty DESC, so.sales_order_no ASC, p.product_no ASC
    `;

    const [rows] = await db.query(sql, params);
    res.json(rows || []);
  } catch (err) {
    console.error("❌ getDeliveryProgress error:", err);
    res.status(500).json({ message: "Server error" });
  }
};





// GET /api/reports/monthly-inout?from=YYYY-MM&to=YYYY-MM&product_id=123
exports.getMonthlySalesPurchases = async (req, res) => {
  const { from = "", to = "", debug = "0" } = req.query;

  const fromClause = `  >= STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d') `;
  const toClause   = `  <  DATE_ADD(LAST_DAY(STR_TO_DATE(CONCAT(?, '-01'), '%Y-%m-%d')), INTERVAL 1 DAY) `;

  // 1) SALES: manual_sets (A,B)
  const salesManualSQL = `
    SELECT DATE_FORMAT(t.safe_date, '%Y-%m') AS ym,
           SUM(t.subtotal)    AS exvat,
           SUM(t.vat_amount)  AS vat,
           SUM(t.grand_total) AS incvat
    FROM (
      SELECT
        CASE WHEN ms.doc_date IS NULL OR YEAR(ms.doc_date)=0 THEN NULL ELSE ms.doc_date END AS safe_date,
        ms.subtotal, ms.vat_amount, ms.grand_total
      FROM manual_sets ms
      WHERE ms.status='APPROVED'
        AND ms.doc_kind IN ('A','B')
    ) t
    WHERE t.safe_date IS NOT NULL
      ${from ? `AND t.safe_date ${fromClause}` : ""}
      ${to   ? `AND t.safe_date ${toClause}`   : ""}
    GROUP BY DATE_FORMAT(t.safe_date, '%Y-%m')
  `;
  const salesManualParams = [];
  if (from) salesManualParams.push(from);
  if (to)   salesManualParams.push(to);

  // 2) SALES: invoices (auto)
  const salesAutoSQL = `
    SELECT DATE_FORMAT(t.safe_date, '%Y-%m') AS ym,
           SUM(t.subtotal)    AS exvat,
           SUM(t.vat_amount)  AS vat,
           SUM(t.grand_total) AS incvat
    FROM (
      SELECT
        CASE WHEN inv.invoice_date IS NULL OR YEAR(inv.invoice_date)=0 THEN NULL ELSE inv.invoice_date END AS safe_date,
        inv.subtotal, inv.vat_amount, inv.grand_total
      FROM invoices inv
      WHERE inv.status='approved'
    ) t
    WHERE t.safe_date IS NOT NULL
      ${from ? `AND t.safe_date ${fromClause}` : ""}
      ${to   ? `AND t.safe_date ${toClause}`   : ""}
    GROUP BY DATE_FORMAT(t.safe_date, '%Y-%m')
  `;
  const salesAutoParams = [];
  if (from) salesAutoParams.push(from);
  if (to)   salesAutoParams.push(to);

  // 3) PURCHASES: manual_sets (PO)
  const purchManualSQL = `
    SELECT DATE_FORMAT(t.safe_date, '%Y-%m') AS ym,
           SUM(t.subtotal)    AS exvat,
           SUM(t.vat_amount)  AS vat,
           SUM(t.grand_total) AS incvat
    FROM (
      SELECT
        CASE WHEN ms.doc_date IS NULL OR YEAR(ms.doc_date)=0 THEN NULL ELSE ms.doc_date END AS safe_date,
        ms.subtotal, ms.vat_amount, ms.grand_total
      FROM manual_sets ms
      WHERE ms.status='APPROVED'
        AND ms.doc_kind='PO'
    ) t
    WHERE t.safe_date IS NOT NULL
      ${from ? `AND t.safe_date ${fromClause}` : ""}
      ${to   ? `AND t.safe_date ${toClause}`   : ""}
    GROUP BY DATE_FORMAT(t.safe_date, '%Y-%m')
  `;
  const purchManualParams = [];
  if (from) purchManualParams.push(from);
  if (to)   purchManualParams.push(to);

  try {
    const [[smRows], [saRows], [pmRows]] = await Promise.all([
      db.query(salesManualSQL, salesManualParams),
      db.query(salesAutoSQL,   salesAutoParams),
      db.query(purchManualSQL, purchManualParams),
    ]);

    const acc = new Map();
    const add = (rows, kind) => {
      rows.forEach(r => {
        if (!r.ym) return;
        if (!acc.has(r.ym)) {
          acc.set(r.ym, {
            month: r.ym,
            sales_exvat: 0, sales_vat: 0, sales_incvat: 0,
            purch_exvat: 0, purch_vat: 0, purch_incvat: 0,
          });
        }
        const o = acc.get(r.ym);
        if (kind === "sales") {
          o.sales_exvat  += Number(r.exvat   || 0);
          o.sales_vat    += Number(r.vat     || 0);
          o.sales_incvat += Number(r.incvat  || 0);
        } else {
          o.purch_exvat  += Number(r.exvat   || 0);
          o.purch_vat    += Number(r.vat     || 0);
          o.purch_incvat += Number(r.incvat  || 0);
        }
      });
    };

    add(smRows, "sales");
    add(saRows, "sales");
    add(pmRows, "purch");

    const rows = [...acc.values()].sort((a, b) => a.month.localeCompare(b.month));

    if (debug === "1") {
      return res.json({
        debug: {
          salesManual: { sql: salesManualSQL, params: salesManualParams, rows: smRows },
          salesAuto:   { sql: salesAutoSQL,   params: salesAutoParams,   rows: saRows },
          purchManual: { sql: purchManualSQL, params: purchManualParams, rows: pmRows },
        },
        result: rows,
      });
    }

    res.json(rows);
  } catch (err) {
    console.error("❌ getMonthlySalesPurchases:", {
      message: err.message, code: err.code, sqlMessage: err.sqlMessage, sql: err.sql
    });
    res.status(500).json({ message: "Internal Server Error" });
  }
};


exports.getProductSales = async (req, res) => {
  try {
    const from = req.query.from || '2025-01-01';
    const to   = req.query.to   || '2036-01-01';
    const gran = (req.query.granularity || 'month').toLowerCase();

    const productId   = req.query.product_id ? Number(req.query.product_id) : null;
    const productNo   = (req.query.product_no   || '').trim() || null;
    const productName = (req.query.product_name || '').trim() || null;

    // period expression
    const periodExpr =
      gran === 'day'     ? "DATE(d)" :
      gran === 'quarter' ? "CONCAT(YEAR(d), '-Q', QUARTER(d))" :
      gran === 'year'    ? "CAST(YEAR(d) AS CHAR)" :
                           "DATE_FORMAT(d, '%Y-%m')"; // default month

    // พารามิเตอร์หลักของ CTE (ช่วงวันที่)
    const params = [from, to, from, to];

    // filter เพิ่มในชั้นนอก (หลัง UNION)
    let outerWhere = ' WHERE 1=1 ';
    if (productId)   { outerWhere += ' AND product_id = ?';        params.push(productId); }
    if (productNo)   { outerWhere += ' AND product_no = ?';        params.push(productNo); }
    if (productName) { outerWhere += ' AND product_name LIKE ?';   params.push(`%${productName}%`); }

    const [rows] = await db.query(
      `
      WITH norm AS (
        /* ===== AUTO (invoices + invoice_items) ===== */
        SELECT
          inv.invoice_date                                       AS d,
          it.product_id                                          AS product_id,
          p.product_no                                           AS product_no,
          COALESCE(p.name, it.description)                       AS product_name,
          it.quantity                                            AS qty,
          it.line_amount                                         AS exvat,
          ROUND(it.line_amount * inv.vat_rate/100, 2)            AS vat,
          it.line_amount + ROUND(it.line_amount * inv.vat_rate/100, 2) AS incvat
        FROM invoices inv
        JOIN invoice_items it ON it.invoice_id = inv.id
        LEFT JOIN products p  ON p.id = it.product_id
        WHERE inv.status='approved'
          AND it.product_id IS NOT NULL
          AND inv.invoice_date >= ?
          AND inv.invoice_date <  ?

        UNION ALL

        /* ===== MANUAL (manual_sets + manual_items) ===== */
        SELECT
          ms.doc_date                                            AS d,
          mi.product_id                                          AS product_id,
          p.product_no                                           AS product_no,
          COALESCE(p.name, mi.description)                       AS product_name,
          mi.quantity                                            AS qty,
          mi.line_amount                                         AS exvat,
          ROUND(mi.line_amount * ms.vat_rate/100, 2)             AS vat,
          mi.line_amount + ROUND(mi.line_amount * ms.vat_rate/100, 2) AS incvat
        FROM manual_sets ms
        JOIN manual_items mi ON mi.manual_set_id = ms.id
        LEFT JOIN products p  ON p.id = mi.product_id
        WHERE ms.status='APPROVED'
          AND ms.doc_kind IN ('A','B')
          AND mi.product_id IS NOT NULL
          AND ms.doc_date >= ?
          AND ms.doc_date <  ?
      )
      SELECT
        ${periodExpr} AS period,
        product_id,
        product_no,
        product_name,
        SUM(qty)      AS qty,
        SUM(exvat)    AS sales_exvat,
        SUM(vat)      AS sales_vat,
        SUM(incvat)   AS sales_incvat
      FROM norm
      ${outerWhere}
      GROUP BY ${periodExpr}, product_id, product_no, product_name
      ORDER BY period, product_no
      `,
      params
    );

    res.json({ ok: true, items: rows });
  } catch (e) {
    console.error('getProductSales error', e);
    res.status(500).json({ ok:false, message: e.message || 'Internal error' });
  }
};



// controllers/reportsController.js
// controllers/reportsController.js
exports.getProductNonMovement = async (req, res) => {
  try {
    const from = req.query.from || '2025-01-01';
    const to   = req.query.to   || '2036-01-01';

    const product_no   = (req.query.product_no  || '').trim();
    const product_name = (req.query.product_name|| '').trim();
    const in_stock_only = req.query.in_stock_only === '1';
    const exclude_newer_than_from = req.query.exclude_newer === '1';

    // ---- สร้าง WHERE ของ products + เก็บพารามิเตอร์ "ตัวกรอง" แยกไว้ก่อน ----
    let prodWhere = `p.is_deleted = 0`;
    const prodParams = [];
    if (in_stock_only) prodWhere += ` AND (p.stock - p.reserved) > 0`;
    if (exclude_newer_than_from) { prodWhere += ` AND (p.created_at IS NULL OR p.created_at < ?)`; prodParams.push(from); }
    if (product_no)   { prodWhere += ` AND p.product_no LIKE ?`; prodParams.push(`%${product_no}%`); }
    if (product_name) { prodWhere += ` AND p.name LIKE ?`;      prodParams.push(`%${product_name}%`); }

    const sql = `
      WITH sales_in_window AS (
        SELECT it.product_id AS product_id, it.quantity AS qty, inv.invoice_date AS d
        FROM invoices inv
        JOIN invoice_items it ON it.invoice_id = inv.id
        WHERE inv.status = 'approved'
          AND it.product_id IS NOT NULL
          AND inv.invoice_date >= ? AND inv.invoice_date < ?
        UNION ALL
        SELECT mi.product_id, mi.quantity, ms.doc_date AS d
        FROM manual_sets ms
        JOIN manual_items mi ON mi.manual_set_id = ms.id
        WHERE ms.status='APPROVED'
          AND ms.doc_kind IN ('A','B')
          AND mi.product_id IS NOT NULL
          AND ms.doc_date >= ? AND ms.doc_date < ?
      ),
      last_sold_before_to AS (
        SELECT t.product_id, MAX(t.d) AS last_sold_date
        FROM (
          SELECT it.product_id AS product_id, inv.invoice_date AS d
          FROM invoices inv
          JOIN invoice_items it ON it.invoice_id = inv.id
          WHERE inv.status='approved' AND it.product_id IS NOT NULL AND inv.invoice_date < ?
          UNION ALL
          SELECT mi.product_id, ms.doc_date AS d
          FROM manual_sets ms
          JOIN manual_items mi ON mi.manual_set_id = ms.id
          WHERE ms.status='APPROVED' AND ms.doc_kind IN ('A','B')
            AND mi.product_id IS NOT NULL AND ms.doc_date < ?
        ) t
        GROUP BY t.product_id
      )
      SELECT
        p.id           AS product_id,
        p.product_no,
        p.name         AS product_name,
        p.unit,
        p.stock,
        p.reserved,
        (p.stock - p.reserved) AS available,
        ls.last_sold_date,
        CASE
          WHEN ls.last_sold_date IS NULL THEN NULL
          ELSE DATEDIFF(CURDATE(), ls.last_sold_date)
        END AS days_since_last_sold
      FROM products p
      LEFT JOIN (
        SELECT product_id, SUM(qty) AS sum_qty
        FROM sales_in_window
        GROUP BY product_id
      ) sw ON sw.product_id = p.id
      LEFT JOIN last_sold_before_to ls ON ls.product_id = p.id
      WHERE ${prodWhere}
        AND (sw.sum_qty IS NULL OR sw.sum_qty = 0)
      ORDER BY
        days_since_last_sold IS NULL, days_since_last_sold DESC, p.product_no ASC
    `;

    // ---- จัดเรียง params ตามลำดับ ? ใน SQL ด้านบน ----
    const params = [
      from, to,      // sales_in_window: inv
      from, to,      // sales_in_window: manual
      to, to,        // last_sold_before_to: inv, manual
      ...prodParams  // เงื่อนไขใน WHERE ของ products (created_at / LIKE เป็นต้น)
    ];

    const [rows] = await db.query(sql, params);
    return res.json({ ok: true, items: rows || [] });
  } catch (e) {
    console.error('getProductNonMovement error', e);
    res.status(500).json({ ok:false, message: e.message || 'Internal error' });
  }
};


