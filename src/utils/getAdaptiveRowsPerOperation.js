/**
 * Get adaptive rows per operation based on workbook size category
 * @param {string} workbookSizeCategory - Size category of the workbook
 * @returns {number} - Number of rows per operation
 */
function getAdaptiveRowsPerOperation(workbookSizeCategory) {
  switch (workbookSizeCategory) {
    case 'small':
      return 20;
    case 'medium':
      return 15;
    case 'large':
      return 10;
    case 'very-large':
      return 5;
    default:
      return 10;
  }
}

module.exports = { getAdaptiveRowsPerOperation };