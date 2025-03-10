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
    // Initialize all modules and connect events
    this.initialize();
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
    
    // Initialize app state based on stored project
    this.initializeState();
    
    console.log("Application initialized");
  }
  
  connectSocketEvents() {
    // EXTRACTION EVENTS
    socketService.on('extraction_progress', (data) => {
      store.updateExtractionProgress(data);
    });
    
    socketService.on('extraction_complete', (data) => {
      store.handleExtractionComplete(data);
    });
    
    socketService.on('extraction_error', (data) => {
      store.handleExtractionError(data);
    });
    
    // TRAINING EVENTS
    socketService.on('training_progress', (data) => {
      store.updateTrainingProgress(data);
    });
    
    socketService.on('training_complete', (data) => {
      store.handleTrainingComplete(data);
    });
    
    socketService.on('training_error', (data) => {
      store.handleTrainingError(data);
    });
    
    // DEPLOYMENT EVENTS
    socketService.on('deployment_progress', (data) => {
      store.updateDeploymentProgress(data);
    });
    
    socketService.on('deployment_complete', (data) => {
      store.handleDeploymentComplete(data);
    });
    
    // js/app.js (continued from previous part)
    socketService.on('deployment_log', (data) => {
        // Update the deployment progress message with log message
        const deploymentProgress = store.get('deploymentProgress');
        
        // Strip log prefixes like "INFO:deploy:" or "INFO:__main__:" from the message
        let cleanMessage = data.message;
        const logPrefixRegex = /^(INFO|DEBUG|WARNING|ERROR):[^:]*:\s*/;
        if (logPrefixRegex.test(cleanMessage)) {
          cleanMessage = cleanMessage.replace(logPrefixRegex, '');
        }
        
        store.set('deploymentProgress', {
          ...deploymentProgress,
          message: cleanMessage
        });
      });
      
      socketService.on('deployment_error', (data) => {
        store.handleDeploymentError(data);
      });
    }
    
    setupEventHandlers() {
      // EXTRACTION PANEL
      const extractBtn = document.getElementById('extract-btn');
      if (extractBtn) {
        extractBtn.addEventListener('click', this.handleExtractData.bind(this));
      }
      
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
      
      // Listen for map events
      map.on('projectRequired', () => {
        panelManager.openPanel('project-modal', 'project-selector-btn');
      });
    }
    
    initializeState() {
      // Always show project selection on startup
      panelManager.openPanel('project-modal', 'project-selector-btn');
    }
    
    // HANDLERS
    
    // Extract data
    handleExtractData(e) {
      const currentProjectId = store.get('currentProjectId');
      if (!currentProjectId) {
        panelManager.openPanel('project-modal', 'project-selector-btn');
        return;
      }
      
      const collection = document.getElementById('collection-select').value;
      const startDate = document.getElementById('start-date').value;
      const endDate = document.getElementById('end-date').value;
      const clearThreshold = parseFloat(document.getElementById('clear-threshold').value);
      
      if (!startDate || !endDate) {
        notificationManager.warning('Please select start and end dates');
        return;
      }
      
      // Show progress container
      const progressContainer = document.getElementById('extraction-progress-container');
      if (progressContainer) {
        progressContainer.classList.add('show');
      }
      
      // Get the project info to retrieve the chip size
      const apiService = new ApiService();
      apiService.getProjectInfo(currentProjectId)
        .then(projectInfo => {
          const chipSize = projectInfo.chip_size || 64; // Default to 64 if not found
          
          // Extract data
          store.extractData({
            collection,
            start_date: startDate,
            end_date: endDate,
            chip_size: chipSize,
            clear_threshold: clearThreshold
          }).catch(error => {
            notificationManager.error(`Error starting extraction: ${error.message}`);
          });
        })
        .catch(error => {
          notificationManager.error(`Error getting project info: ${error.message}`);
        });
    }
    
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
    
    // Create project
    handleCreateProject(e) {
      const projectName = document.getElementById('new-project-name').value.trim();
      
      if (!projectName) {
        notificationManager.warning('Please enter a project name');
        return;
      }
      
      const chipSize = parseInt(document.getElementById('project-chip-size').value);
      
      const apiService = new ApiService();
      apiService.createProject(projectName, chipSize)
        .then(data => {
          if (data.success) {
            // Select the new project
            panelManager.selectProject(projectName, data.project_id);
            notificationManager.success(`Project "${projectName}" created`);
          } else {
            throw new Error(data.message || 'Failed to create project');
          }
        })
        .catch(error => {
          notificationManager.error(`Error creating project: ${error.message}`);
        });
    }
    
    // Clear points
    handleClearPoints(e) {
      if (store.get('points').length === 0) return;
      
      if (confirm('Clear all points?')) {
        store.clearPoints();
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
      const batchSize = parseInt(document.getElementById('batch-size').value) || 8;
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
      const tileSize = parseInt(document.getElementById('tile-size').value);
      const tilePadding = parseInt(document.getElementById('tile-padding').value);
      const batchSize = parseInt(document.getElementById('batch-size').value);
      const tries = parseInt(document.getElementById('tries').value);
      
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
        tile_size: tileSize,
        tile_padding: tilePadding,
        batch_size: batchSize,
        region: {
          type: 'Polygon',
          coordinates: [[
            [bounds.getWest(), bounds.getNorth()],
            [bounds.getEast(), bounds.getNorth()],
            [bounds.getEast(), bounds.getSouth()],
            [bounds.getWest(), bounds.getSouth()],
            [bounds.getWest(), bounds.getNorth()]
          ]]
        },
        tries: tries
      }).catch(error => {
        notificationManager.error(`Error starting deployment: ${error.message}`);
        document.getElementById('deploy-btn').disabled = false;
      });
    }
    
    // Load map imagery
    handleMapImagery(e) {
      e.preventDefault();
      
      const collection = document.getElementById('imagery-collection').value;
      const startDate = document.getElementById('imagery-start-date').value;
      const endDate = document.getElementById('imagery-end-date').value;
      const clearThreshold = document.getElementById('imagery-clear-threshold').value;
      
      // Get the current map bounds
      const bounds = map.mapInstance.getBounds();
      
      const statusElement = document.getElementById('imagery-status');
      statusElement.style.display = 'flex';
      
      try {
        // Clean up any existing overlay
        map.cleanupMapImagery();
        
        // Fetch map imagery from the backend
        const apiService = new ApiService();
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
          
          // Change to a light style
          map.changeMapStyle('mapbox://styles/mapbox/light-v10', true);
          
          // Listen for style load event
          map.once('styleLoaded', () => {
            // Add the raster tiles as a source
            map.mapInstance.addSource('sentinel-imagery', {
              type: 'raster',
              tiles: [data.tile_url],
              tileSize: 256,
              attribution: `Sentinel ${collection === 'S2' ? '2' : '1'} Imagery (${startDate} to ${endDate})`
            });
            
            // Add the raster layer (make sure it's below the points)
            map.mapInstance.addLayer({
              id: 'sentinel-imagery',
              type: 'raster',
              source: 'sentinel-imagery',
              paint: {
                'raster-opacity': 1.0
              }
            }, 'point-positive'); // Add below the points layers
            
            // Zoom to the imagery bounds
            map.mapInstance.fitBounds(imageBounds, { padding: 50 });
            
            statusElement.style.display = 'none';
            notificationManager.success('Sentinel imagery loaded successfully');
          });
        }).catch(error => {
          console.error('Error loading map imagery:', error);
          statusElement.style.display = 'none';
          notificationManager.error(`Error loading map imagery: ${error.message}`);
        });
      } catch (error) {
        console.error('Error loading map imagery:', error);
        statusElement.style.display = 'none';
        notificationManager.error(`Error loading map imagery: ${error.message}`);
      }
    }
    
    // Remove map imagery
    handleRemoveImagery(e) {
      try {
        // Clean up the overlay
        map.cleanupMapImagery();
        
        // Change back to satellite style
        map.changeMapStyle('mapbox://styles/mapbox/satellite-v9', true);
        
        notificationManager.info('Satellite imagery removed');
      } catch (error) {
        console.error('Error removing imagery:', error);
        notificationManager.error('Error removing satellite imagery');
      }
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
  }
  
  // Initialize the application when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
  });
  
  export { App };