const { shard } = require('../utils/ids');

function objectMetaPath(objectId) {
  const { a, b } = shard(objectId);
  return `objects/${a}/${b}/${objectId}.json`;
}

function objectDataDir(apiId, objectId, collection = 'default') {
  const { a, b } = shard(objectId);
  return `data/${apiId}/${collection}/${a}/${b}/${objectId}`;
}

function objectDataPath(apiId, objectId, storedName = 'content', collection = 'default') {
  return `${objectDataDir(apiId, objectId, collection)}/${storedName}`;
}

function trashMetaPath(apiId, objectId) {
  const { a, b } = shard(objectId);
  return `trash/${apiId}/${a}/${b}/${objectId}.json`;
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
  trashMetaPath,
  apiPath,
  apiIndexPath,
  txPath,
  logPath,
};
