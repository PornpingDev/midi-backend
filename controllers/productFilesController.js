const db = require('../db/connection');
const { Storage } = require('@google-cloud/storage');
const path = require('path');
const uuid = require('uuid').v4;

// 📌 ตั้งค่าการเชื่อมต่อ GCS
const storage = new Storage({
  keyFilename: path.join(__dirname, '../gcs-key/midi-file-uploader.json')
});
const bucketName = 'midi-project-file-data';
const bucket = storage.bucket(bucketName);

exports.uploadProductFiles = async (req, res) => {
  const { product_no } = req.params;
  const { file_type } = req.body;

  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ message: 'กรุณาเลือกไฟล์ก่อนอัปโหลด' });
  }

  if (!file_type || !['drawing', 'product-image', 'qc-document'].includes(file_type)) {
    return res.status(400).json({ message: 'ประเภทไฟล์ไม่ถูกต้อง' });
  }

  try {
    const uploadedFiles = [];

    for (const file of req.files) {
      const ext = path.extname(file.originalname);
      const gcsFileName = `${file_type}/${product_no}_${uuid()}${ext}`;
      const blob = bucket.file(gcsFileName);

      const blobStream = blob.createWriteStream({
        resumable: false,
        contentType: file.mimetype,
      });

      await new Promise((resolve, reject) => {
        blobStream.on('finish', resolve);
        blobStream.on('error', reject);
        blobStream.end(file.buffer);
      });

      // ✅ ทำให้ไฟล์นี้ public
      

      const publicUrl = `https://storage.googleapis.com/${bucketName}/${gcsFileName}`;

      await db.query(
        `INSERT INTO product_files (product_no, file_name, file_url, file_type) VALUES (?, ?, ?, ?)`,
        [product_no, file.originalname, publicUrl, file_type]
      );

      uploadedFiles.push({ name: file.originalname, url: publicUrl });
    }

    res.status(201).json({ message: 'อัปโหลดไฟล์สำเร็จ', files: uploadedFiles });

  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดระหว่างการอัปโหลดไฟล์' });
  }
};


exports.getProductFiles = async (req, res) => {
  const { product_no } = req.params;
  const { file_type } = req.query;

  if (!product_no || !file_type) {
    return res.status(400).json({ message: 'กรุณาระบุ product_no และ file_type' });
  }

  try {
    const [rows] = await db.query(
      `SELECT id, file_name, file_url, file_type
       FROM product_files
       WHERE product_no = ? AND file_type = ?`,
      [product_no, file_type]
    );

    res.json({ files: rows });

  } catch (error) {
    console.error('❌ Error fetching files:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการดึงไฟล์' });
  }
};


exports.deleteProductFile = async (req, res) => {
  const { id } = req.params;

  try {
    // 1. ดึงข้อมูลไฟล์ก่อน
    const [rows] = await db.query(
      'SELECT file_url FROM product_files WHERE id = ?',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'ไม่พบไฟล์ที่ต้องการลบ' });
    }

    const fileUrl = rows[0].file_url;
    const filePath = fileUrl.split(`https://storage.googleapis.com/${bucketName}/`)[1]; // 🔍 ตัด path

    // 2. ลบไฟล์จาก GCS
    await bucket.file(filePath).delete();

    // 3. ลบจากฐานข้อมูล
    await db.query('DELETE FROM product_files WHERE id = ?', [id]);

    res.json({ message: 'ลบไฟล์เรียบร้อยแล้ว' });

  } catch (error) {
    console.error('❌ Error deleting product file:', error);
    res.status(500).json({ message: 'เกิดข้อผิดพลาดในการลบไฟล์' });
  }
};

