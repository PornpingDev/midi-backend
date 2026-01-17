// utils/gcsConfig.js
const { Storage } = require('@google-cloud/storage');
const path = require('path');

const storage = new Storage({
  keyFilename: path.join(__dirname, '../gcs-key/midi-file-uploader.json'), // ปรับ path ตามจริงถ้าต่าง
  projectId: 'midi-project-452208',
});

const bucket = storage.bucket('midi-project-file-data'); // ชื่อ bucket ที่สร้างไว้ใน GCS

module.exports = { storage, bucket };
