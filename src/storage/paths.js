const { shard } = require('../utils/ids');

function objectMetaPath(objectId) {
  const { a, b } = shard(objectId);
  return `objects/${a}/${b}/${objectId}.json`;
}

function objectDataDir(apiId, objectId) {
  const { a, b } = shard(objectId);
  return `data/${apiId}/${a}/${b}/${objectId}`;
}

function objectDataPath(apiId, objectId, storedName = 'file.bin') {
  return `${objectDataDir(apiId, objectId)}/${storedName}`;
}

function apiPath(apiId) {
  return `apis/${apiId}.json`;
}

function apiIndexPath(apiId) {
  return `indexes/${apiId}/objects.json`;
}

function txPath(id) {
  return `transactions/${id}.json`;
}

function logPath(day, name) {
  return `logs/${day}/${name}.json`;
}

module.exports = {
  objectMetaPath,
  objectDataDir,
  objectDataPath,
  apiPath,
  apiIndexPath,
  txPath,
  logPath,
};
