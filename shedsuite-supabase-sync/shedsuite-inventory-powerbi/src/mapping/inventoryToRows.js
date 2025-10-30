'use strict';

function parseNumber(n) {
  if (n == null) return null;
  if (typeof n === 'string') {
    const cleaned = n.replace(/[^0-9.-]/g, '');
    const v = Number(cleaned);
    return Number.isFinite(v) ? v : null;
  }
  return Number.isFinite(n) ? n : null;
}

function toIso(d) {
  if (!d) return null;
  try {
    const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
    return date.toISOString();
  } catch {
    return null;
  }
}

function feetToInches(v) {
  const num = parseNumber(v);
  return num == null ? null : Math.round(num * 12);
}

function mapInventoryItemToRow(item) {
  // Fields per Postman sample: id, serialNumber, buildingWidth, buildingLength, dateBuilt, locatedAtDealerName, builtAtShopName, buildingModelName, price (string with $), orderStatusDetailed
  const widthFeet = item.buildingWidth ?? null;
  const lengthFeet = item.buildingLength ?? null;
  const location = item.locatedAtDealerName || item.locatedAtShopName || null;
  const color = item.sidingColor || item.roofColor || null;
  const material = item.sidingCategory || item.roofCategory || null;
  return {
    inventoryId: item.id ?? null,
    sku: item.serialNumber || null,
    status: item.orderStatusDetailed || item.orderStatus || null,
    location,
    widthInches: feetToInches(widthFeet),
    lengthInches: feetToInches(lengthFeet),
    heightInches: null,
    color,
    material,
    price: parseNumber(item.price || item.retailPrice || item.salePrice),
    cost: parseNumber(item.cost || item.wholesaleCost),
    createdAt: toIso(item.dateBuilt || item.createdAt || item.created_at || item.created),
    updatedAt: toIso(item.updatedAt || item.updated_at || item.updated),
    isAvailable: typeof item.forSale === 'boolean' ? item.forSale : (item.onHold === false ? true : null),
    vendorName: item.builtAtShopName || null,
    model: item.buildingModelName || item.model || item.modelName || null
  };
}

function mapInventoryToRows(items) {
  return items.map(mapInventoryItemToRow);
}

module.exports = { mapInventoryItemToRow, mapInventoryToRows };


