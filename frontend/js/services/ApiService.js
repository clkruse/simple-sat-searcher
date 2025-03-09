// js/services/ApiService.js
import { config } from '../config.js';

class ApiService {
  constructor() {
    this.apiUrl = config.API_URL;
  }
  
  /**
   * Make a GET request to the API
   * @param {string} endpoint - API endpoint path
   * @param {Object} queryParams - Query parameters
   * @returns {Promise<Object>} - JSON response
   */
  async get(endpoint, queryParams = {}) {
    try {
      // Build query string from params
      const queryString = Object.entries(queryParams)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
      
      const url = `${this.apiUrl}/${endpoint}${queryString ? `?${queryString}` : ''}`;
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`API GET error for ${endpoint}:`, error);
      throw error;
    }
  }
  
  /**
   * Make a POST request to the API
   * @param {string} endpoint - API endpoint path
   * @param {Object} data - Request body data
   * @returns {Promise<Object>} - JSON response
   */
  async post(endpoint, data = {}) {
    try {
      const url = `${this.apiUrl}/${endpoint}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.error(`API POST error for ${endpoint}:`, error);
      throw error;
    }
  }
  
  // PROJECT ENDPOINTS
  
  /**
   * Create a new project
   * @param {string} name - Project name
   * @returns {Promise<Object>} - Project data
   */
  async createProject(name) {
    return this.post('create_project', { name });
  }
  
  /**
   * List all projects
   * @returns {Promise<Object>} - List of projects
   */
  async listProjects() {
    return this.get('list_projects');
  }
  
  /**
   * Load points for a project
   * @param {string} projectId - Project ID
   * @param {string} filename - Optional filename (defaults to points.geojson)
   * @returns {Promise<Object>} - GeoJSON points data
   */
  async loadPoints(projectId, filename = 'points.geojson') {
    return this.get('load_points', { project_id: projectId, filename });
  }
  
  /**
   * Export points to a project
   * @param {Object} geojson - GeoJSON points data
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>} - Export result
   */
  async exportPoints(geojson, projectId) {
    return this.post('export_points', { geojson, project_id: projectId });
  }
  
  // EXTRACTION ENDPOINTS
  
  /**
   * Extract satellite data
   * @param {Object} options - Extraction options
   * @returns {Promise<Object>} - Extraction result
   */
  async extractData(options) {
    return this.post('extract_data', options);
  }
  
  /**
   * List extracted data for a project
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>} - List of extractions
   */
  async listExtractedData(projectId) {
    return this.get('list_extracted_data', { project_id: projectId });
  }
  
  // VISUALIZATION ENDPOINTS
  
  /**
   * Get patch visualization data
   * @param {string} projectId - Project ID
   * @param {string} file - Extraction file
   * @param {string} visType - Visualization type
   * @returns {Promise<Object>} - Visualization data
   */
  async getPatchVisualization(projectId, file, visType) {
    return this.get('get_patch_visualization', { 
      project_id: projectId, 
      file, 
      vis_type: visType 
    });
  }
  
  // TRAINING ENDPOINTS
  
  /**
   * Train a model
   * @param {Object} options - Training options
   * @returns {Promise<Object>} - Training result
   */
  async trainModel(options) {
    return this.post('train_model', options);
  }
  
  /**
   * List models for a project
   * @param {string} projectId - Project ID
   * @returns {Promise<Object>} - List of models
   */
  async listModels(projectId) {
    return this.get('list_models', { project_id: projectId });
  }
  
  // DEPLOYMENT ENDPOINTS
  
  /**
   * Deploy a model
   * @param {Object} options - Deployment options
   * @returns {Promise<Object>} - Deployment result
   */
  async deployModel(options) {
    return this.post('deploy_model', options);
  }
  
  // MAP IMAGERY ENDPOINTS
  
  /**
   * Get map imagery
   * @param {Object} options - Map imagery options
   * @returns {Promise<Object>} - Map imagery data
   */
  async getMapImagery(options) {
    return this.get('get_map_imagery', options);
  }
}

export { ApiService };