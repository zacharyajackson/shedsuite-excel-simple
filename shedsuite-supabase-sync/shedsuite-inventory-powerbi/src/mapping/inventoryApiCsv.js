'use strict';

// Headers aligned to ShedSuite Inventory API field names (non-exhaustive but broad)
const apiHeaders = [
  'id',
  'serialNumber',
  'buildingModelId',
  'buildingModelName',
  'buildingSize',
  'buildingStage',
  'buildingWidth',
  'buildingLength',
  'companyId',
  'companyName',
  'condition',
  'dateBuilt',
  'dateBuiltUnix',
  'dateRemoved',
  'dateRemovedUnix',
  'estimatedBuildDate',
  'estimatedBuildDateUnix',
  'forSale',
  'onHold',
  'orderStatus',
  'orderStatusDetailed',
  'price',
  'roofCategory',
  'roofColor',
  'sidingCategory',
  'sidingColor',
  'trimCategory',
  'trimColor',
  'title',
  'builtAtShopId',
  'builtAtShopName',
  'locatedAtDealerId',
  'locatedAtDealerName',
  'locatedAtShopId',
  'locatedAtShopName',
  'shopStaffBuilderId',
  'shopStaffBuilderName',
  'shopStaffExteriorFinisherId',
  'shopStaffExteriorFinisherName',
  'shopStaffRooferId',
  'shopStaffRooferName'
];

function mapItemToApiRow(item) {
  const row = {};
  for (const h of apiHeaders) row[h] = item?.[h] ?? null;
  return row;
}

function mapInventoryToApiRows(items) {
  return items.map(mapItemToApiRow);
}

module.exports = { apiHeaders, mapInventoryToApiRows };


