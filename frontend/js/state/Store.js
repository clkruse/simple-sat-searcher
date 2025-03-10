// js/state/Store.js
import { EventEmitter } from '../utils/EventEmitter.js';
import { ApiService } from '../services/ApiService.js';

class Store extends EventEmitter {
  constructor() {
    super();
    this.apiService = new ApiService();
    
    // Initialize application state
    this.state = {
      currentProjectId: null,
      currentProjectName: 'No Project Selected',
      points: [],
      pointCounts: {
        positive: 0,
        negative: 0,
        total: 0
      },
      extractions: [],
      models: [],
      extractionProgress: {
        inProgress: false,
        percent: 0,
        current: 0,
        total: 0,
        message: ''
      },
      trainingProgress: {
        inProgress: false,
        percent: 0,
        epoch: 0,
        totalEpochs: 0,
        logs: {}
      },
      deploymentProgress: {
        inProgress: false,
        percent: 0,
        message: ''
      },
      activeVisualization: null
    };
    
    // Load persisted state from localStorage
    this.loadPersistedState();
  }
  
  // Load state from localStorage
  loadPersistedState() {
    const projectId = localStorage.getItem('currentProjectId');
    const projectName = localStorage.getItem('currentProjectName');
    
    if (projectId) {
      this.state.currentProjectId = projectId;
      this.state.currentProjectName = projectName || 'Unnamed Project';
    }
  }
  
  // Get state value
  get(key) {
    return this.state[key];
  }
  
  // Set state value and notify listeners
  set(key, value) {
    const oldValue = this.state[key];
    this.state[key] = value;
    
    // Only emit if the value has changed (basic equality check)
    if (oldValue !== value) {
      this.emit(key, value);
      this.emit('stateChanged', { key, value, oldValue });
    }
    
    return value;
  }
  
  // Add a point to the state
  addPoint(point) {
    const points = [...this.state.points, point];
    this.set('points', points);
    this.updatePointCounts();
    return point;
  }
  
  // Remove a point from the state
  removePoint(pointId) {
    const updatedPoints = this.state.points.filter(p => p.properties.id !== pointId);
    this.set('points', updatedPoints);
    this.updatePointCounts();
    return pointId;
  }
  
  // Clear all points
  clearPoints() {
    this.set('points', []);
    this.updatePointCounts();
  }
  
  // Set current project
  setCurrentProject(id, name) {
    this.set('currentProjectId', id);
    this.set('currentProjectName', name);
    
    // Persist to localStorage
    localStorage.setItem('currentProjectId', id);
    localStorage.setItem('currentProjectName', name);
    
    // Clear state
    this.clearPoints();
    this.set('extractions', []);
    this.set('models', []);
    
    return { id, name };
  }
  
  // Calculate and update point counts
  updatePointCounts() {
    const positiveCount = this.state.points.filter(p => p.properties.class === 'positive').length;
    const negativeCount = this.state.points.filter(p => p.properties.class === 'negative').length;
    const totalCount = positiveCount + negativeCount;
    
    const counts = { positive: positiveCount, negative: negativeCount, total: totalCount };
    this.set('pointCounts', counts);
    
    return counts;
  }
  
  // Convert points to GeoJSON format
  pointsToGeoJSON() {
    return {
      type: 'FeatureCollection',
      features: this.state.points
    };
  }
  
  // API ACTIONS
  
  // Load points for the current project
  async loadProjectPoints(latestExport = null) {
    if (!this.state.currentProjectId) return false;
    
    try {
      const filename = latestExport || 'points.geojson';
      const response = await this.apiService.loadPoints(this.state.currentProjectId, filename);
      
      if (response.success && response.geojson && response.geojson.features) {
        this.set('points', response.geojson.features);
        this.updatePointCounts();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error loading project points:', error);
      this.emit('error', { message: 'Failed to load project points', error });
      return false;
    }
  }
  
  // Export points to the backend
  async exportPoints(showNotification = false) {
    if (!this.state.currentProjectId || this.state.points.length === 0) {
      return false;
    }
    
    try {
      const response = await this.apiService.exportPoints(
        this.pointsToGeoJSON(),
        this.state.currentProjectId
      );
      
      if (response.success) {
        if (showNotification) {
          this.emit('notification', {
            type: 'success',
            message: `Exported ${this.state.points.length} points`
          });
        }
        return true;
      } else {
        throw new Error(response.message || 'Failed to export points');
      }
    } catch (error) {
      console.error('Error exporting points:', error);
      this.emit('error', { message: 'Failed to export points', error });
      return false;
    }
  }
  
  // Load projects list
  async loadProjects() {
    try {
      const response = await this.apiService.listProjects();
      if (response.success) {
        this.emit('projectsLoaded', response.projects);
        return response.projects;
      } else {
        throw new Error(response.message || 'Failed to load projects');
      }
    } catch (error) {
      console.error('Error loading projects:', error);
      this.emit('error', { message: 'Failed to load projects', error });
      return [];
    }
  }
  
  // Load extractions for the current project
  async loadExtractions() {
    if (!this.state.currentProjectId) return [];
    
    try {
      const response = await this.apiService.listExtractedData(this.state.currentProjectId);
      if (response.success) {
        this.set('extractions', response.extractions || []);
        return response.extractions;
      } else {
        throw new Error(response.message || 'Failed to load extractions');
      }
    } catch (error) {
      console.error('Error loading extractions:', error);
      this.emit('error', { message: 'Failed to load extractions', error });
      return [];
    }
  }
  
  // Extract data for the current project
  async extractData(options) {
    if (!this.state.currentProjectId) return false;
    
    // Set extraction in progress
    this.set('extractionProgress', {
      inProgress: true,
      percent: 0,
      current: 0,
      total: 0,
      message: 'Starting extraction...'
    });
    
    try {
      // Add project ID to options
      const extractOptions = {
        project_id: this.state.currentProjectId,
        ...options
      };
      
      const response = await this.apiService.extractData(extractOptions);
      
      if (!response.success) {
        throw new Error(response.message || 'Failed to start extraction');
      }
      
      return true;
    } catch (error) {
      console.error('Error starting extraction:', error);
      this.emit('error', { message: 'Failed to start extraction', error });
      
      // Reset extraction progress
      this.set('extractionProgress', {
        inProgress: false,
        percent: 0,
        current: 0,
        total: 0,
        message: `Error: ${error.message}`
      });
      
      return false;
    }
  }
  
  // Update extraction progress
  updateExtractionProgress(data) {
    if (data.project_id !== this.state.currentProjectId) return;
    
    this.set('extractionProgress', {
      inProgress: true,
      percent: data.progress,
      current: data.current,
      total: data.total,
      message: `Extracting data: ${data.current}/${data.total} points (${Math.round(data.progress)}%)`
    });
  }
  
  // Handle extraction completion
  handleExtractionComplete(data) {
    if (data.project_id !== this.state.currentProjectId) return;
    
    this.set('extractionProgress', {
      inProgress: false,
      percent: 100,
      current: data.metadata?.num_chips || 0,
      total: data.metadata?.num_chips || 0,
      message: `Extraction complete! Extracted ${data.metadata?.num_chips || 0} chips`
    });
    
    // Reload extractions list
    this.loadExtractions();
    
    // Show success notification
    this.emit('notification', {
      type: 'success',
      message: `Extraction complete! Extracted ${data.metadata?.num_chips || 0} chips`
    });
  }
  
  // Handle extraction error
  handleExtractionError(data) {
    if (data.project_id !== this.state.currentProjectId) return;
    
    this.set('extractionProgress', {
      inProgress: false,
      percent: 0,
      current: 0,
      total: 0,
      message: `Error: ${data.error}`
    });
    
    // Show error notification
    this.emit('notification', {
      type: 'error',
      message: `Error during extraction: ${data.error}`
    });
  }
  
  // Load models for the current project
  async loadModels() {
    if (!this.state.currentProjectId) return [];
    
    try {
      const response = await this.apiService.listModels(this.state.currentProjectId);
      if (response.success) {
        this.set('models', response.models || []);
        return response.models;
      } else {
        throw new Error(response.message || 'Failed to load models');
      }
    } catch (error) {
      console.error('Error loading models:', error);
      this.emit('error', { message: 'Failed to load models', error });
      return [];
    }
  }
  
  // Train a model
  async trainModel(options) {
    if (!this.state.currentProjectId) return false;
    
    // Set training in progress
    this.set('trainingProgress', {
      inProgress: true,
      percent: 0,
      epoch: 0,
      totalEpochs: options.epochs || 10,
      logs: {}
    });
    
    try {
      // Add project ID to options
      const trainingOptions = {
        project_id: this.state.currentProjectId,
        ...options
      };
      
      const response = await this.apiService.trainModel(trainingOptions);
      
      if (!response.success) {
        throw new Error(response.message || 'Failed to start training');
      }
      
      return true;
    } catch (error) {
      console.error('Error starting training:', error);
      this.emit('error', { message: 'Failed to start training', error });
      
      // Reset training progress
      this.set('trainingProgress', {
        inProgress: false,
        percent: 0,
        epoch: 0,
        totalEpochs: 0,
        logs: {}
      });
      
      return false;
    }
  }
  
  // Update training progress
  updateTrainingProgress(data) {
    if (data.project_id !== this.state.currentProjectId) return;
    
    this.set('trainingProgress', {
      inProgress: true,
      percent: data.progress,
      epoch: data.current_epoch,
      totalEpochs: data.total_epochs,
      logs: data.logs || {}
    });
  }
  
  // Handle training completion
  handleTrainingComplete(data) {
    if (data.project_id !== this.state.currentProjectId) return;
    
    // Get accuracy from metrics, handling different naming conventions
    const finalAcc = data.metrics.accuracy || data.metrics.acc || 0;
    const finalValAcc = data.metrics.val_accuracy || data.metrics.val_acc || 0;
    
    this.set('trainingProgress', {
      inProgress: false,
      percent: 100,
      epoch: data.metrics.epochs || 0,
      totalEpochs: data.metrics.epochs || 0,
      logs: data.metrics || {}
    });
    
    // Reload models list
    this.loadModels();
    
    // Re-enable train button
    const trainBtn = document.getElementById('train-btn');
    if (trainBtn) {
      trainBtn.disabled = false;
    }
    
    // Show success notification
    this.emit('notification', {
      type: 'success',
      message: `Model '${data.model_name}' trained successfully! Final accuracy: ${(finalValAcc * 100).toFixed(1)}%`
    });
  }
  
  // Handle training error
  handleTrainingError(data) {
    if (data.project_id !== this.state.currentProjectId) return;
    
    this.set('trainingProgress', {
      inProgress: false,
      percent: 0,
      epoch: 0,
      totalEpochs: 0,
      logs: {}
    });
    
    // Re-enable train button
    const trainBtn = document.getElementById('train-btn');
    if (trainBtn) {
      trainBtn.disabled = false;
    }
    
    // Show error notification
    this.emit('notification', {
      type: 'error',
      message: `Training error: ${data.error}`
    });
  }
  
  // Deploy a model
  async deployModel(options) {
    if (!this.state.currentProjectId) return false;
    
    // Set deployment in progress
    this.set('deploymentProgress', {
      inProgress: true,
      percent: 0,
      message: 'Starting deployment...'
    });
    
    try {
      // Add project ID to options
      const deploymentOptions = {
        project_id: this.state.currentProjectId,
        ...options
      };
      
      const response = await this.apiService.deployModel(deploymentOptions);
      
      if (!response.success) {
        throw new Error(response.message || 'Failed to start deployment');
      }
      
      return true;
    } catch (error) {
      console.error('Error starting deployment:', error);
      this.emit('error', { message: 'Failed to start deployment', error });
      
      // Reset deployment progress
      this.set('deploymentProgress', {
        inProgress: false,
        percent: 0,
        message: `Error: ${error.message}`
      });
      
      return false;
    }
  }
  
  // Update deployment progress
  updateDeploymentProgress(data) {
    const percent = Math.round(data.progress * 100);
    
    this.set('deploymentProgress', {
      inProgress: true,
      percent: percent,
      message: data.status || `Processing (${percent}%)`
    });
    
    // If there are incremental predictions, emit an event
    if (data.incremental_predictions && data.incremental_predictions.features) {
      this.emit('deploymentIncrementalUpdate', {
        predictions: data.incremental_predictions,
        boundingBox: data.bounding_box
      });
    }
  }
  
  // Handle deployment completion
  handleDeploymentComplete(data) {
    this.set('deploymentProgress', {
      inProgress: false,
      percent: 100,
      message: 'Deployment complete!'
    });
    
    // Re-enable deploy button
    const deployBtn = document.getElementById('deploy-btn');
    if (deployBtn) {
      deployBtn.disabled = false;
    }
    
    // Emit an event with the predictions
    this.emit('deploymentComplete', {
      predictions: data.predictions,
      boundingBox: data.bounding_box
    });
    
    // Show success notification
    this.emit('notification', {
      type: 'success',
      message: `Deployment complete: ${data.predictions?.features?.length || 0} predictions displayed`
    });
  }
  
  // Handle deployment error
  handleDeploymentError(data) {
    this.set('deploymentProgress', {
      inProgress: false,
      percent: 0,
      message: `Error: ${data.error}`
    });
    
    // Re-enable deploy button
    const deployBtn = document.getElementById('deploy-btn');
    if (deployBtn) {
      deployBtn.disabled = false;
    }
    
    // Show error notification
    this.emit('notification', {
      type: 'error',
      message: `Deployment error: ${data.error}`
    });
  }
}

// Create a singleton instance
const store = new Store();

export { store };