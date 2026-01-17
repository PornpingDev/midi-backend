const { bucket } = require("./gcsConfig");
const { v4: uuidv4 } = require("uuid");

async function uploadFileToGCS(buffer, originalName, folder) {
  const uniqueName = `${folder}/${Date.now()}-${uuidv4()}-${originalName}`;
  const file = bucket.file(uniqueName);

  await file.save(buffer, {
    resumable: false,
    public: true,
    contentType: "auto",
    metadata: {
      cacheControl: "no-cache",
    },
  });

  return `https://storage.googleapis.com/${bucket.name}/${uniqueName}`;
}

module.exports = { uploadFileToGCS };
