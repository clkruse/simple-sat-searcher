// js/utils/formatters.js

/**
 * Format date as YYYY-MM-DD
 * @param {Date} date - Date to format
 * @returns {string} - Formatted date string
 */
export function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  
  /**
   * Gets a human-readable label for visualization type
   * @param {string} visualizationType - The visualization type ID
   * @returns {string} - Human-readable label
   */
  export function getVisualizeTypeLabel(visualizationType) {
    switch (visualizationType) {
      case 'true_color':
        return 'True Color (RGB)';
      case 'false_color':
        return 'False Color (NIR)';
      case 'ndvi':
        return 'NDVI (Vegetation Index)';
      default:
        return visualizationType;
    }
  }
  
  /**
   * Format file size nicely
   * @param {number} bytes - Size in bytes
   * @returns {string} - Formatted size string
   */
  export function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    else if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    else if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    else return (bytes / 1073741824).toFixed(1) + ' GB';
  }
  
  /**
   * Format a date for display
   * @param {string|Date} date - Date to format
   * @returns {string} - Formatted date string
   */
  export function formatDisplayDate(date) {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }