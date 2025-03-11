// js/app.js
import { store } from './state/Store.js';
import { map } from './components/Map.js';
import { panelManager } from './components/panels/PanelManager.js';
import { socketService } from './services/SocketService.js';
import { notificationManager } from './components/Notification.js';
import { formatDate, getVisualizeTypeLabel } from './utils/formatters.js';
import { ApiService } from './services/ApiService.js';

class App {
  constructor() {
    // Initialize components
    this.mapComponent = map;
    this.panelManager = panelManager;
    this.notificationManager = notificationManager;
    
    // Initialize state
    this.selectedLocation = null;
    this.locationSelectionHandler = null;
    
    // Initialize all modules and connect events
    this.initialize();
    
    // Initialize notification system
    this.notificationTimeout = null;
    
    // Expose map component for other modules to use
    this.map = map;
    
    // Expose app instance to window for global access
    window.app = this;
  }
  
  initialize() {
    // Listen for socket events and update store
    this.connectSocketEvents();
    
    // Setup UI event handlers
    this.setupEventHandlers();
    
    // Listen for store notifications
    store.on('notification', (notification) => {
      notificationManager[notification.type](notification.message);
    });
    
    store.on('error', (error) => {
      notificationManager.error(error.message);
      console.error(error.message, error.error);
    });
    
    // Listen for extraction progress updates
    store.on('extractionProgress', (progress) => {
      const progressBar = document.getElementById('extraction-progress');
      const progressText = document.getElementById('extraction-progress-text');
      const progressContainer = document.getElementById('extraction-progress-container');
      
      if (progressBar && progressText) {
        progressBar.style.width = `${progress.percent}%`;
        progressText.textContent = progress.message;
        
        if (progressContainer && !progressContainer.classList.contains('show')) {
          progressContainer.classList.add('show');
        }
      }
    });
    
    // Listen for training progress updates
    store.on('trainingProgress', (progress) => {
      const progressBar = document.getElementById('training-progress');
      const progressText = document.getElementById('training-progress-text');
      const trainingStatus = document.getElementById('training-status');
      
      if (progressBar && progressText) {
        progressBar.style.width = `${progress.percent}%`;
        progressText.textContent = `Training: Epoch ${progress.epoch}/${progress.totalEpochs} (${Math.round(progress.percent)}%)`;
        
        // Update accuracy bars if logs are available
        if (progress.logs && Object.keys(progress.logs).length > 0) {
          const trainingAccuracyBar = document.getElementById('training-accuracy-bar');
          const validationAccuracyBar = document.getElementById('validation-accuracy-bar');
          const trainingAccuracyValue = document.getElementById('training-accuracy-value');
          const validationAccuracyValue = document.getElementById('validation-accuracy-value');
          
          const trainingAcc = progress.logs.accuracy || progress.logs.acc || 0;
          const validationAcc = progress.logs.val_accuracy || progress.logs.val_acc || 0;
          
          if (trainingAccuracyBar && validationAccuracyBar) {
            trainingAccuracyBar.style.width = `${trainingAcc * 100}%`;
            validationAccuracyBar.style.width = `${validationAcc * 100}%`;
            
            if (trainingAccuracyValue) trainingAccuracyValue.textContent = `${(trainingAcc * 100).toFixed(1)}%`;
            if (validationAccuracyValue) validationAccuracyValue.textContent = `${(validationAcc * 100).toFixed(1)}%`;
          }
        }
        
        if (trainingStatus && trainingStatus.classList.contains('hidden')) {
          trainingStatus.classList.remove('hidden');
        }
      }
    });
    
    // Listen for deployment progress updates
    store.on('deploymentProgress', (progress) => {
      const progressBar = document.getElementById('deployment-progress');
      const progressText = document.getElementById('deployment-progress-text');
      const deploymentStatus = document.getElementById('deployment-status');
      
      if (progressBar && progressText) {
        progressBar.style.width = `${progress.percent}%`;
        progressText.textContent = progress.message;
        
        if (deploymentStatus && deploymentStatus.classList.contains('hidden')) {
          deploymentStatus.classList.remove('hidden');
        }
      }
    });
    
    // Initialize app state based on stored project
    this.initializeState();
    
    console.log("Application initialized");
  }
  
  connectSocketEvents() {
    // Connect to socket.io server
    socketService.connect();
    
    // Listen for extraction progress updates
    socketService.on('extraction_progress', (data) => {
      store.updateExtractionProgress(data);
    });
    
    // Listen for extraction completion
    socketService.on('extraction_complete', (data) => {
      store.handleExtractionComplete(data);
    });
    
    // Listen for extraction errors
    socketService.on('extraction_error', (data) => {
      store.handleExtractionError(data);
    });
    
    // Listen for training progress updates
    socketService.on('training_progress', (data) => {
      store.updateTrainingProgress(data);
    });
    
    // Listen for training completion
    socketService.on('training_complete', (data) => {
      store.handleTrainingComplete(data);
    });
    
    // Listen for training errors
    socketService.on('training_error', (data) => {
      store.handleTrainingError(data);
    });
    
    // Listen for deployment progress updates
    socketService.on('deployment_progress', (data) => {
      store.updateDeploymentProgress(data);
    });
    
    // Listen for deployment completion
    socketService.on('deployment_complete', (data) => {
      store.handleDeploymentComplete(data);
      
      // Refresh the deployments list
      store.loadPredictions().then(predictions => {
        panelManager.updateDeploymentsList(predictions);
      });
    });
    
    // Listen for deployment errors
    socketService.on('deployment_error', (data) => {
      store.handleDeploymentError(data);
    });
    
    // Listen for deployment logs
    socketService.on('deployment_log', (data) => {
      console.log('Deployment log:', data.message);
    });
  }
  
  setupEventHandlers() {
    // VISUALIZATION PANEL
    const loadVisualizationBtn = document.getElementById('load-visualization-btn');
    if (loadVisualizationBtn) {
      loadVisualizationBtn.addEventListener('click', this.handleLoadVisualization.bind(this));
    }
    
    const clearVisualizationBtn = document.getElementById('clear-visualization-btn');
    if (clearVisualizationBtn) {
      clearVisualizationBtn.addEventListener('click', this.handleClearVisualization.bind(this));
    }
    
    // PROJECT MODAL
    const createProjectBtn = document.getElementById('create-project-btn');
    if (createProjectBtn) {
      createProjectBtn.addEventListener('click', this.handleCreateProject.bind(this));
    }
    
    // Select location button
    const selectLocationBtn = document.getElementById('select-location-btn');
    if (selectLocationBtn) {
      selectLocationBtn.addEventListener('click', this.handleSelectLocation.bind(this));
    }
    
    // CLEAR POINTS
    const clearBtn = document.getElementById('clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', this.handleClearPoints.bind(this));
    }
    
    // TRAINING PANEL
    const trainBtn = document.getElementById('train-btn');
    if (trainBtn) {
      trainBtn.addEventListener('click', this.handleTrainModel.bind(this));
    }
    
    // DEPLOYMENT PANEL
    const deployBtn = document.getElementById('deploy-btn');
    if (deployBtn) {
      deployBtn.addEventListener('click', this.handleDeployModel.bind(this));
    }
    
    // MAP IMAGERY PANEL
    const mapImageryForm = document.getElementById('map-imagery-form');
    if (mapImageryForm) {
      mapImageryForm.addEventListener('submit', this.handleMapImagery.bind(this));
    }
    
    const removeImageryBtn = document.getElementById('remove-imagery-btn');
    if (removeImageryBtn) {
      removeImageryBtn.addEventListener('click', this.handleRemoveImagery.bind(this));
    }
    
    // CONTROL PANEL IMAGERY BUTTONS
    const controlLoadImageryBtn = document.getElementById('control-load-imagery-btn');
    if (controlLoadImageryBtn) {
      controlLoadImageryBtn.addEventListener('click', this.handleControlLoadImagery.bind(this));
    }
    
    const controlRemoveImageryBtn = document.getElementById('control-remove-imagery-btn');
    if (controlRemoveImageryBtn) {
      controlRemoveImageryBtn.addEventListener('click', this.handleRemoveImagery.bind(this));
    }
    
    // THRESHOLD SLIDERS
    const clearThreshold = document.getElementById('clear-threshold');
    if (clearThreshold) {
      clearThreshold.addEventListener('input', (e) => {
        document.getElementById('threshold-value').textContent = e.target.value;
      });
    }
    
    const imageryThreshold = document.getElementById('imagery-clear-threshold');
    if (imageryThreshold) {
      imageryThreshold.addEventListener('input', (e) => {
        document.getElementById('imagery-threshold-value').textContent = e.target.value;
      });
    }
    
    const controlThreshold = document.getElementById('control-clear-threshold');
    if (controlThreshold) {
      controlThreshold.addEventListener('input', (e) => {
        document.getElementById('control-threshold-value').textContent = e.target.value;
      });
    }
    
    // SYNC SETTINGS BETWEEN PANELS
    // Control panel to map imagery panel sync
    const controlStartDate = document.getElementById('control-start-date');
    const controlEndDate = document.getElementById('control-end-date');
    const controlCollection = document.getElementById('control-collection');
    
    if (controlStartDate) {
      controlStartDate.addEventListener('change', (e) => {
        const imageryStartDate = document.getElementById('imagery-start-date');
        if (imageryStartDate) {
          imageryStartDate.value = e.target.value;
        }
      });
    }
    
    if (controlEndDate) {
      controlEndDate.addEventListener('change', (e) => {
        const imageryEndDate = document.getElementById('imagery-end-date');
        if (imageryEndDate) {
          imageryEndDate.value = e.target.value;
        }
      });
    }
    
    if (controlCollection) {
      controlCollection.addEventListener('change', (e) => {
        const imageryCollection = document.getElementById('imagery-collection');
        if (imageryCollection) {
          imageryCollection.value = e.target.value;
        }
      });
    }
    
    if (controlThreshold) {
      controlThreshold.addEventListener('change', (e) => {
        const imageryThreshold = document.getElementById('imagery-clear-threshold');
        if (imageryThreshold) {
          imageryThreshold.value = e.target.value;
          document.getElementById('imagery-threshold-value').textContent = e.target.value;
        }
      });
    }
    
    // Map imagery panel to control panel sync
    const imageryStartDate = document.getElementById('imagery-start-date');
    const imageryEndDate = document.getElementById('imagery-end-date');
    const imageryCollection = document.getElementById('imagery-collection');
    
    if (imageryStartDate) {
      imageryStartDate.addEventListener('change', (e) => {
        const controlStartDate = document.getElementById('control-start-date');
        if (controlStartDate) {
          controlStartDate.value = e.target.value;
        }
      });
    }
    
    if (imageryEndDate) {
      imageryEndDate.addEventListener('change', (e) => {
        const controlEndDate = document.getElementById('control-end-date');
        if (controlEndDate) {
          controlEndDate.value = e.target.value;
        }
      });
    }
    
    if (imageryCollection) {
      imageryCollection.addEventListener('change', (e) => {
        const controlCollection = document.getElementById('control-collection');
        if (controlCollection) {
          controlCollection.value = e.target.value;
        }
      });
    }
    
    if (imageryThreshold) {
      imageryThreshold.addEventListener('change', (e) => {
        const controlThreshold = document.getElementById('control-clear-threshold');
        if (controlThreshold) {
          controlThreshold.value = e.target.value;
          document.getElementById('control-threshold-value').textContent = e.target.value;
        }
      });
    }
    
    // Listen for map events
    map.on('projectRequired', () => {
      panelManager.openPanel('project-modal', 'project-selector-btn');
    });
  }
  
  initializeState() {
    // Always show project selection on startup
    panelManager.openPanel('project-modal', 'project-selector-btn');
    
    // Initialize state from store
    const points = store.get('points') || [];
    const currentProjectId = store.get('currentProjectId');
    
    // Update UI state based on the current base layer
    this.updateImageryButtonsState(map.currentBaseLayer || 'satellite');
  }
  
  // HANDLERS
  
  // Load visualization
  handleLoadVisualization(e) {
    const currentProjectId = store.get('currentProjectId');
    if (!currentProjectId) {
      panelManager.openPanel('project-modal', 'project-selector-btn');
      return;
    }
    
    const extractionFile = document.getElementById('visualization-extraction').value;
    const visualizationType = document.getElementById('visualization-type').value;
    
    if (!extractionFile) {
      notificationManager.warning('Please select an extraction to visualize');
      return;
    }
    
    // Show loading status
    document.getElementById('visualization-status').classList.remove('hidden');
    document.getElementById('visualization-controls').classList.add('hidden');
    document.getElementById('visualization-info').classList.add('hidden');
    
    // Fetch visualization data
    const apiService = new ApiService();
    apiService.getPatchVisualization(currentProjectId, extractionFile, visualizationType)
      .then(data => {
        if (data.success) {
          // Display patches on the map
          map.displayPatches(data.patches, visualizationType);
          
          // Update visualization info
          document.getElementById('vis-collection').textContent = data.collection;
          document.getElementById('vis-patches').textContent = data.patches.length;
          document.getElementById('vis-mode').textContent = getVisualizeTypeLabel(visualizationType);
          
          // Update legend
          this.updateLegend(visualizationType, data.collection);
          
          // Show info
          document.getElementById('visualization-info').classList.remove('hidden');

          
          // Show clear button
          document.getElementById('clear-visualization-btn').classList.remove('hidden');
        } else {
          throw new Error(data.message || 'Failed to load visualization');
        }
      })
      .catch(error => {
        notificationManager.error(`Error loading visualization: ${error.message}`);
      })
      .finally(() => {
        // Hide loading, show controls
        document.getElementById('visualization-status').classList.add('hidden');
        document.getElementById('visualization-controls').classList.remove('hidden');
      });
  }
  
  // Clear visualization
  handleClearVisualization(e) {
    map.clearVisualization();
    document.getElementById('visualization-info').classList.add('hidden');
    document.getElementById('clear-visualization-btn').classList.add('hidden');
  }
  
  /**
   * Handle selecting a location on the map for a new project
   */
  handleSelectLocation(e) {
    e.preventDefault();
    
    // Hide the project modal
    const projectModal = document.getElementById('project-modal');
    projectModal.style.display = 'none';
    
    // Add a banner to indicate selection mode
    const banner = document.createElement('div');
    banner.className = 'location-selection-banner';
    banner.innerHTML = `
      <span>Click on the map to set default location</span>
      <button id="cancel-location-selection">Cancel</button>
    `;
    document.body.appendChild(banner);
    
    // Add a class to the map to change cursor
    document.getElementById('map').classList.add('map-selection-active');
    
    // Set up cancel button
    document.getElementById('cancel-location-selection').addEventListener('click', () => {
      this.cancelLocationSelection();
    });
    
    // Store the current map instance
    const mapInstance = this.mapComponent.mapInstance;
    
    // Create one-time click handler for the map
    this.locationSelectionHandler = (e) => {
      // Get the clicked coordinates with 6 decimal places for storage
      const lat = e.lngLat.lat.toFixed(6);
      const lng = e.lngLat.lng.toFixed(6);
      
      // Format coordinates with 2 decimal places for display
      const displayLat = parseFloat(lat).toFixed(2);
      const displayLng = parseFloat(lng).toFixed(2);
      
      // Update the button text with shortened coordinates
      const selectLocationBtn = document.getElementById('select-location-btn');
      if (selectLocationBtn) {
        selectLocationBtn.textContent = `${displayLat}, ${displayLng}`;
        selectLocationBtn.classList.add('has-coordinates');
      }
      
      // Store the coordinates for later use
      this.selectedLocation = {
        lat: parseFloat(lat),
        lng: parseFloat(lng)
      };
      
      // Clean up and show the modal again
      this.cancelLocationSelection();
      projectModal.style.display = 'block';
    };
    
    // Add the click handler to the map
    mapInstance.once('click', this.locationSelectionHandler);
  }
  
  /**
   * Cancel the location selection mode
   */
  cancelLocationSelection() {
    // Remove the banner
    const banner = document.querySelector('.location-selection-banner');
    if (banner) {
      banner.remove();
    }
    
    // Remove the map class
    document.getElementById('map').classList.remove('map-selection-active');
    
    // Show the project modal again
    document.getElementById('project-modal').style.display = 'block';
    
    // Remove the click handler if it exists
    if (this.locationSelectionHandler && this.mapComponent && this.mapComponent.mapInstance) {
      this.mapComponent.mapInstance.off('click', this.locationSelectionHandler);
    }
    
    // If no location is selected, make sure the button text is reset
    if (!this.selectedLocation) {
      const selectLocationBtn = document.getElementById('select-location-btn');
      if (selectLocationBtn && selectLocationBtn.textContent !== 'Set') {
        selectLocationBtn.textContent = 'Set';
      }
    }
  }
  
  // Create project
  handleCreateProject(e) {
    const projectName = document.getElementById('new-project-name').value.trim();
    
    if (!projectName) {
      this.notificationManager.warning('Please enter a project name');
      return;
    }
    
    const chipSize = parseInt(document.getElementById('project-chip-size').value);
    const dataSource = document.getElementById('project-data-source').value;
    
    const apiService = new ApiService();
    apiService.createProject(projectName, chipSize, dataSource, this.selectedLocation)
      .then(data => {
        if (data.success) {
          // Select the new project
          this.panelManager.selectProject(projectName, data.project_id);
          this.notificationManager.success(`Project "${projectName}" created`);
          
          // Clear the selected location for next time
          this.selectedLocation = null;
          
          // Reset the button text
          const selectLocationBtn = document.getElementById('select-location-btn');
          if (selectLocationBtn) {
            selectLocationBtn.textContent = 'Set';
            selectLocationBtn.classList.remove('has-coordinates');
          }
        } else {
          throw new Error(data.message || 'Failed to create project');
        }
      })
      .catch(error => {
        this.notificationManager.error(`Error creating project: ${error.message}`);
      });
  }
  
  // Clear points
  handleClearPoints(e) {
    const clearBtn = document.getElementById('clear-btn');
    
    // Toggle the active state of the Clear Points button
    if (clearBtn.classList.contains('active')) {
      // Deactivate Clear Points mode
      clearBtn.classList.remove('active');
      this.showNotification('Point removal mode disabled', 'info');
    } else {
      // Activate Clear Points mode
      clearBtn.classList.add('active');
      this.showNotification('Click on points to remove them', 'info');
    }
  }
  
  // Train model
  handleTrainModel(e) {
    const currentProjectId = store.get('currentProjectId');
    if (!currentProjectId) {
      panelManager.openPanel('project-modal', 'project-selector-btn');
      return;
    }
    
    const modelName = document.getElementById('model-name').value.trim();
    
    if (!modelName) {
      notificationManager.warning('Please enter a model name');
      return;
    }
    
    // Check if we're using project data (dropdown is hidden)
    const trainingExtractionsContainer = document.getElementById('training-extractions-container');
    const isUsingProjectData = trainingExtractionsContainer && 
                              (trainingExtractionsContainer.style.display === 'none' || 
                               trainingExtractionsContainer.classList.contains('hidden'));
    
    let selectedExtractions = [];
    
    if (isUsingProjectData) {
      // When using project data, get the value directly from the hidden select element
      const trainingSelect = document.getElementById('training-extractions');
      if (trainingSelect && trainingSelect.options && trainingSelect.options.length > 0) {
        selectedExtractions = [trainingSelect.options[0].value];
      } else {
        // Let the backend find it
        selectedExtractions = ['auto_detect'];
      }
    } else {
      // Normal mode: get selected options from the dropdown
      const trainingSelect = document.getElementById('training-extractions');
      if (trainingSelect && trainingSelect.selectedOptions) {
        selectedExtractions = Array.from(trainingSelect.selectedOptions)
          .map(option => option.value);
      } else {
        selectedExtractions = ['auto_detect'];
      }
    }
    
    // Get form values
    const batchSize = parseInt(document.getElementById('batch-size').value) || 4;
    const epochs = parseInt(document.getElementById('epochs').value) || 64;
    const testSplit = parseFloat(document.getElementById('test-split').value) || 0.1;
    const useAugmentation = document.getElementById('use-augmentation').checked;
    
    // Reset progress UI
    const progressBar = document.getElementById('training-progress');
    const progressText = document.getElementById('training-progress-text');
    const trainingAccuracyBar = document.getElementById('training-accuracy-bar');
    const validationAccuracyBar = document.getElementById('validation-accuracy-bar');
    const trainingAccuracyValue = document.getElementById('training-accuracy-value');
    const validationAccuracyValue = document.getElementById('validation-accuracy-value');
    
    if (progressBar && progressText) {
      progressBar.style.width = '0%';
      progressText.textContent = 'Starting training...';
    }
    
    // Reset accuracy bars
    if (trainingAccuracyBar && validationAccuracyBar) {
      trainingAccuracyBar.style.width = '0%';
      validationAccuracyBar.style.width = '0%';
      if (trainingAccuracyValue) trainingAccuracyValue.textContent = '0.0%';
      if (validationAccuracyValue) validationAccuracyValue.textContent = '0.0%';
    }
    
    // Show status panel
    const trainingStatus = document.getElementById('training-status');
    if (trainingStatus) {
      trainingStatus.classList.remove('hidden');
    }
    
    // Disable train button
    const trainBtn = document.getElementById('train-btn');
    if (trainBtn) {
      trainBtn.disabled = true;
    }
    
    // Train model
    store.trainModel({
      model_name: modelName,
      extraction_files: selectedExtractions,
      batch_size: batchSize,
      epochs: epochs,
      test_split: testSplit,
      augmentation: useAugmentation
    }).then(() => {
      // Success is handled by socket event
    }).catch(error => {
      notificationManager.error(`Error starting training: ${error.message}`);
      // Re-enable train button
      if (trainBtn) {
        trainBtn.disabled = false;
      }
    });
  }
  
  // Deploy model
  handleDeployModel(e) {
    const currentProjectId = store.get('currentProjectId');
    if (!currentProjectId) {
      panelManager.openPanel('project-modal', 'project-selector-btn');
      return;
    }
    
    const modelName = document.getElementById('deployment-model').value;
    const startDate = document.getElementById('deployment-start-date').value;
    const endDate = document.getElementById('deployment-end-date').value;
    const predThreshold = parseFloat(document.getElementById('pred-threshold').value);
    const clearThreshold = parseFloat(document.getElementById('clear-threshold').value);
    
    if (!modelName) {
      notificationManager.warning('Please select a model to deploy');
      return;
    }
    
    if (!startDate || !endDate) {
      notificationManager.warning('Please select start and end dates');
      return;
    }
    
    // Clear any existing predictions from the map
    if (map.mapInstance.getLayer('deployment-predictions-line')) {
      map.mapInstance.removeLayer('deployment-predictions-line');
    }
    if (map.mapInstance.getSource('deployment-predictions')) {
      map.mapInstance.removeSource('deployment-predictions');
    }
    if (map.mapInstance.getLayer('deployment-bbox')) {
      map.mapInstance.removeLayer('deployment-bbox');
    }
    if (map.mapInstance.getSource('deployment-bbox')) {
      map.mapInstance.removeSource('deployment-bbox');
    }
    
    // Reset progress bar
    const progressBar = document.getElementById('deployment-progress');
    const progressText = document.getElementById('deployment-progress-text');
    
    if (progressBar && progressText) {
      progressBar.style.width = '0%';
      progressText.textContent = 'Deploying...';
    }
    
    // Show status
    document.getElementById('deployment-status').classList.remove('hidden');
    document.getElementById('deploy-btn').disabled = true;
    
    // Get the current map bounds
    const bounds = map.mapInstance.getBounds();
    
    // Deploy model
    store.deployModel({
      model_name: modelName,
      start_date: startDate,
      end_date: endDate,
      pred_threshold: predThreshold,
      clear_threshold: clearThreshold,
      tile_size: 512,
      batch_size: 500,
      tries: 2,
      region: {
        type: 'Polygon',
        coordinates: [[
          [bounds.getWest(), bounds.getNorth()],
          [bounds.getEast(), bounds.getNorth()],
          [bounds.getEast(), bounds.getSouth()],
          [bounds.getWest(), bounds.getSouth()],
          [bounds.getWest(), bounds.getNorth()]
        ]]
      }
    }).catch(error => {
      notificationManager.error(`Error starting deployment: ${error.message}`);
      document.getElementById('deploy-btn').disabled = false;
    });
  }
  
  // Load map imagery
  handleMapImagery(e) {
    e.preventDefault();
    
    const startDate = document.getElementById('imagery-start-date').value;
    const endDate = document.getElementById('imagery-end-date').value;
    const clearThreshold = document.getElementById('imagery-clear-threshold').value;
    
    // Get the current project ID
    const currentProjectId = store.get('currentProjectId');
    if (!currentProjectId) {
      notificationManager.warning('No project selected');
      return;
    }
    
    // Get the current map bounds
    const bounds = map.mapInstance.getBounds();
    
    const statusElement = document.getElementById('imagery-status');
    statusElement.style.display = 'flex';
    
    // Get the project info to get the data source
    const apiService = new ApiService();
    apiService.getProjectInfo(currentProjectId)
      .then(projectInfo => {
        const collection = projectInfo.data_source || 'S2'; // Default to S2 if not specified
        
        // Fetch map imagery from the backend
        return apiService.getMapImagery({
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
          start_date: startDate,
          end_date: endDate,
          collection: collection,
          clear_threshold: clearThreshold
        });
      })
      .then(data => {
        if (!data.success) {
          throw new Error(data.message || 'Failed to load map imagery');
        }
        
        // Define the image bounds 
        const imageBounds = [
          [data.bounds.west, data.bounds.south], // Southwest coordinates
          [data.bounds.east, data.bounds.north]  // Northeast coordinates
        ];
        
        // Set the custom base layer using our new method
        return map.setBaseLayer('custom', {
          tileUrl: data.tile_url,
          collection: data.collection,
          startDate: startDate,
          endDate: endDate,
          bounds: imageBounds,
          attribution: `${data.collection} (${startDate} to ${endDate})`
        }).then(() => {
          // Update legend
          this.updateLegend('true_color', data.collection);
          
          // Hide loading status
          statusElement.style.display = 'none';
          
          // Update UI state to show that custom imagery is active
          this.updateImageryButtonsState('custom');
          
          // Show notification
          notificationManager.success(`Loaded ${data.collection} imagery for ${startDate} to ${endDate}`);
        });
      })
      .catch(error => {
        statusElement.style.display = 'none';
        notificationManager.error(`Error loading map imagery: ${error.message}`);
      });
  }
  
  // Remove map imagery
  handleRemoveImagery(e) {
    try {
      // Switch back to the default satellite base layer
      map.setBaseLayer('satellite')
        .then(() => {
          // Update UI state to show that default imagery is active
          this.updateImageryButtonsState('satellite');
          
          // Show notification
          notificationManager.success('Imagery removed');
          
          // Re-visualize all point patches to ensure they're still visible
          const currentProjectId = store.get('currentProjectId');
          if (currentProjectId) {
            // Small delay to ensure everything is ready
            setTimeout(() => {
              map.visualizeAllPointPatches(currentProjectId, false); // false = don't clear existing
            }, 100);
          }
        });
    } catch (error) {
      console.error('Error removing imagery:', error);
      notificationManager.error(`Error removing imagery: ${error.message}`);
    }
  }
  
  // Helper method to update UI state based on active base layer
  updateImageryButtonsState(activeLayer) {
    const loadImageryBtn = document.getElementById('control-load-imagery-btn');
    const removeImageryBtn = document.getElementById('control-remove-imagery-btn');
    
    if (loadImageryBtn && removeImageryBtn) {
      if (activeLayer === 'custom') {
        loadImageryBtn.disabled = true;
        removeImageryBtn.disabled = false;
      } else {
        loadImageryBtn.disabled = false;
        removeImageryBtn.disabled = true;
      }
    }
  }
  
  // Load map imagery from control panel
  handleControlLoadImagery(e) {
    e.preventDefault();
    
    const startDate = document.getElementById('control-start-date').value;
    const endDate = document.getElementById('control-end-date').value;
    const clearThreshold = document.getElementById('control-clear-threshold').value;
    
    if (!startDate || !endDate) {
      return;
    }
    
    // Get the current project ID and data source
    const currentProjectId = store.get('currentProjectId');
    if (!currentProjectId) {
      notificationManager.warning('No project selected');
      return;
    }
    
    // Get the project info to get the data source
    const apiService = new ApiService();
    apiService.getProjectInfo(currentProjectId)
      .then(projectInfo => {
        const collection = projectInfo.data_source || 'S2'; // Default to S2 if not specified
        
        // Show/hide the clear threshold based on the collection
        const thresholdContainer = document.getElementById('control-threshold-container');
        if (thresholdContainer) {
          thresholdContainer.style.display = collection === 'S2' ? 'block' : 'none';
        }
        
        // Get the current map bounds
        const bounds = map.mapInstance.getBounds();
        
        // Fetch map imagery from the backend
        apiService.getMapImagery({
          west: bounds.getWest(),
          south: bounds.getSouth(),
          east: bounds.getEast(),
          north: bounds.getNorth(),
          start_date: startDate,
          end_date: endDate,
          collection: collection,
          clear_threshold: clearThreshold
        }).then(data => {
          if (!data.success) {
            throw new Error(data.message || 'Failed to load map imagery');
          }
          
          // Define the image bounds 
          const imageBounds = [
            [data.bounds.west, data.bounds.south], // Southwest coordinates
            [data.bounds.east, data.bounds.north]  // Northeast coordinates
          ];
          
          // Set the custom base layer using our new method
          return map.setBaseLayer('custom', {
            tileUrl: data.tile_url,
            collection: data.collection,
            startDate: startDate,
            endDate: endDate,
            bounds: imageBounds,
            attribution: `${data.collection} (${startDate} to ${endDate})`
          }).then(() => {
            // Update legend
            this.updateLegend('true_color', data.collection);
            
            // Update UI state to show that custom imagery is active
            this.updateImageryButtonsState('custom');
            
            // Re-visualize all point patches to ensure they're still visible
            setTimeout(() => {
              map.visualizeAllPointPatches(currentProjectId, false); // false = don't clear existing
            }, 100);
            
            // Show notification
            notificationManager.success(`Loaded ${data.collection} imagery for ${startDate} to ${endDate}`);
          });
        }).catch(error => {
          notificationManager.error(`Error loading imagery: ${error.message}`);
        });
      })
      .catch(error => {
        notificationManager.error(`Error getting project info: ${error.message}`);
      });
  }
  
  // Update visualization legend
  updateLegend(visualizationType, collection) {
    const legendContainer = document.getElementById('vis-legend');
    legendContainer.innerHTML = '';
    
    if (collection === 'S2') {
      if (visualizationType === 'true_color') {
        // True color legend
        legendContainer.innerHTML = `
          <div class="legend-item">
            <div class="legend-color" style="background-color: #ff0000;"></div>
            <span>Red: Band 4 (Red, 665 nm)</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background-color: #00ff00;"></div>
            <span>Green: Band 3 (Green, 560 nm)</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background-color: #0000ff;"></div>
            <span>Blue: Band 2 (Blue, 490 nm)</span>
          </div>
        `;
      } else if (visualizationType === 'false_color') {
        // False color legend
        legendContainer.innerHTML = `
          <div class="legend-item">
            <div class="legend-color" style="background-color: #ff0000;"></div>
            <span>Red: Band 8 (NIR, 842 nm)</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background-color: #00ff00;"></div>
            <span>Green: Band 4 (Red, 665 nm)</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background-color: #0000ff;"></div>
            <span>Blue: Band 3 (Green, 560 nm)</span>
          </div>
        `;
      } else if (visualizationType === 'ndvi') {
        // NDVI legend
        legendContainer.innerHTML = `
          <div class="ndvi-legend"></div>
          <div class="ndvi-scale">
            <span>0</span>
            <span>0.5</span>
            <span>1</span>
          </div>
          <div class="legend-item">
            <span>Vegetation health/density</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background-color: #1a9850;"></div>
            <span>Healthy vegetation</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background-color: #d9ef8b;"></div>
            <span>Sparse vegetation</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background-color: #fc8d59;"></div>
            <span>Soil/non-vegetation</span>
          </div>
          <div class="legend-item">
            <div class="legend-color" style="background-color: #d73027;"></div>
            <span>Water/shadows</span>
          </div>
        `;
      }
    } else if (collection === 'S1') {
      // Sentinel-1 legend
      legendContainer.innerHTML = `
        <div class="legend-item">
          <div class="legend-color" style="background-color: #ffffff;"></div>
          <span>Bright areas: Urban, bare soil, rough water</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background-color: #888888;"></div>
          <span>Medium areas: Low vegetation, medium roughness</span>
        </div>
        <div class="legend-item">
          <div class="legend-color" style="background-color: #000000;"></div>
          <span>Dark areas: Smooth water, roads</span>
        </div>
      `;
    }
  }
  
  // Show a notification to the user
  showNotification(message, type = 'info') {
    // Clear any existing notification timeout
    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
    }
    
    // Get or create notification element
    let notification = document.getElementById('notification');
    if (!notification) {
      notification = document.createElement('div');
      notification.id = 'notification';
      document.body.appendChild(notification);
    }
    
    // Set notification content and type
    notification.textContent = message;
    notification.className = `notification ${type}`;
    
    // Show the notification
    notification.classList.add('show');
    
    // Hide after 3 seconds
    this.notificationTimeout = setTimeout(() => {
      notification.classList.remove('show');
    }, 3000);
  }
}

// Initialize the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});

export { App };