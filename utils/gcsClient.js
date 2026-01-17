const { Storage } = require('@google-cloud/storage');
const path = require('path');

// เชื่อมต่อผ่าน service account
const storage = new Storage({
  keyFilename: path.join(__dirname, '../gcs-key/midi-file-uploader.json'), 
  projectId: 'midi-project-452208',
});

const bucket = storage.bucket('midi-project-file-data'); 

module.exports = { storage, bucket };
