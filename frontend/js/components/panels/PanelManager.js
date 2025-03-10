// js/components/panels/PanelManager.js
import { EventEmitter } from '../../utils/EventEmitter.js';
import { config } from '../../config.js';
import { store } from '../../state/Store.js';
import { notificationManager } from '../Notification.js';
import { formatDate } from '../../utils/formatters.js';

class PanelManager extends EventEmitter {
  constructor() {
    super();
    this.panels = config.panels;
    this.activePanel = null;
    
    // Initialize when DOM is loaded
    document.addEventListener('DOMContentLoaded', () => {
      this.initialize();
    });
  }
  
  initialize() {
    // Set up event listeners for all sidebar buttons
    Object.entries(this.panels).forEach(([panelId, panel]) => {
      const button = document.getElementById(panel.buttonId);
      if (button) {
        button.addEventListener('click', () => this.openPanel(panelId, panel.buttonId));
      }
      
      // Add event listeners to all close buttons
      const panelEl = document.getElementById(panelId);
      if (panelEl) {
        const closeBtn = panelEl.querySelector('.close-btn');
        if (closeBtn) {
          closeBtn.addEventListener('click', () => this.closePanel(panelId));
        }
      }
    });
    
    // Initial state - hide all panels
    this.closeAllPanels();
    
    // Listen for point count changes and update the UI in real-time
    store.on('pointCounts', this.updatePointCountsDisplay.bind(this));
  }
  
  openPanel(panelId, buttonId) {
    // Check if project is required but not selected
    if (!store.get('currentProjectId') && panelId !== 'project-modal') {
      notificationManager.warning('Please select a project first');
      this.openPanel('project-modal', 'project-selector-btn');
      return;
    }
    
    // For certain panels, check if points exist
    if ((panelId === 'extract-panel' || panelId === 'visualization-panel') && 
        store.get('points').length === 0 && 
        store.get('currentProjectId')) {
      notificationManager.warning('Please add some points to the map first');
      this.openPanel('control-panel', 'point-tool-btn');
      return;
    }
    
    // Close all currently open panels
    this.closeAllPanels();
    
    // Open requested panel
    const panel = document.getElementById(panelId);
    if (panel) {
      panel.classList.add('active');
      this.activePanel = panelId;
      
      // Set active state on sidebar button
      if (buttonId) {
        this.setActiveSidebarButton(buttonId);
      }
      
      // Run any panel-specific initialization
      this.runPanelInitializer(panelId);
      
      // If opening the control panel, update point counts
      if (panelId === 'control-panel') {
        this.updatePointCountsDisplay(store.get('pointCounts'));
      }
      
      // Emit event for other components
      this.emit('panel:opened', { panelId, buttonId });
    }
  }
  
  closePanel(panelId) {
    const panel = document.getElementById(panelId);
    if (panel) {
      panel.classList.remove('active');
      
      // Reset the active panel tracking
      if (this.activePanel === panelId) {
        this.activePanel = null;
      }
      
      // Reset sidebar active state to default (project selector)
      this.setActiveSidebarButton('project-selector-btn');
      
      // Special handling for certain panels
      if (panelId === 'extract-panel') {
        // Reset extraction progress
        const progressContainer = document.getElementById('extraction-progress-container');
        const progressBar = document.getElementById('extraction-progress');
        const progressText = document.getElementById('extraction-progress-text');
        
        if (progressContainer) {
          progressContainer.classList.remove('show');
        }
        
        if (progressBar && progressText) {
          progressBar.style.width = '0%';
          progressText.textContent = 'Ready to extract';
        }
      }
      
      // Emit event
      this.emit('panel:closed', { panelId });
    }
  }
  
  closeAllPanels() {
    // Close all explicitly tracked panels
    Object.keys(this.panels).forEach(panelId => {
      const panel = document.getElementById(panelId);
      if (panel) {
        panel.classList.remove('active');
      }
    });
    
    // Also find and close any other panels or modals that might be open
    document.querySelectorAll('.panel, .modal').forEach(panel => {
      panel.classList.remove('active');
      panel.style.removeProperty('visibility');
      panel.style.removeProperty('opacity');
      panel.style.removeProperty('transform');
    });
    
    // Reset active panel tracking
    this.activePanel = null;
    
    // Reset all sidebar button active states
    document.querySelectorAll('.sidebar-item').forEach(item => {
      item.classList.remove('active');
    });
    
    // Emit event
    this.emit('panels:all-closed');
  }
  
  setActiveSidebarButton(buttonId) {
    // Remove active class from all sidebar items
    document.querySelectorAll('.sidebar-item').forEach(item => {
      item.classList.remove('active');
    });
    
    // Add active class to specified button
    const button = document.getElementById(buttonId);
    if (button) {
      button.classList.add('active');
    }
  }
  
  runPanelInitializer(panelId) {
    switch (panelId) {
      case 'control-panel':
        this.initializeControlPanel();
        break;
        
      case 'extract-panel':
        this.initializeExtractPanel();
        break;
        
      case 'visualization-panel':
        this.initializeVisualizationPanel();
        break;
        
      case 'project-modal':
        this.initializeProjectModal();
        break;
        
      case 'training-panel':
        this.initializeTrainingPanel();
        break;
        
      case 'deployment-panel':
        this.initializeDeploymentPanel();
        break;
        
      case 'map-imagery-panel':
        this.initializeMapImageryPanel();
        break;
    }
  }
  
  initializeControlPanel() {
    // Update panel header with project name
    document.getElementById('project-name').textContent = store.get('currentProjectName');
    
    // Update point counts
    this.updatePointCountsDisplay(store.get('pointCounts'));
  }
  
  initializeExtractPanel() {
    // Set default dates
    this.setupDateRange('start-date', 'end-date', 30);
    
    // Load previous extractions
    store.loadExtractions().then(extractions => {
      this.updateExtractionsList(extractions);
    });
  }
  
  initializeVisualizationPanel() {
    // Load extractions for visualization
    store.loadExtractions().then(extractions => {
      this.updateVisualizationExtractions(extractions);
    });
  }
  
  initializeProjectModal() {
    // Load projects list
    store.loadProjects().then(projects => {
      this.updateProjectsList(projects);
    });
  }
  
  initializeTrainingPanel() {
    // Load extractions for training
    store.loadExtractions().then(extractions => {
      this.updateTrainingExtractions(extractions);
    });
    
    // Load models
    store.loadModels().then(models => {
      this.updateModelsList(models);
    });
  }
  
  initializeDeploymentPanel() {
    // Set default dates
    this.setupDateRange('deployment-start-date', 'deployment-end-date', 30);
    
    // Load models for deployment
    store.loadModels().then(models => {
      this.updateDeploymentModels(models);
    });
  }
  
  initializeMapImageryPanel() {
    // Set default dates
    this.setupDateRange('imagery-start-date', 'imagery-end-date', 30);
  }
  
  // Helper method to update extractions list
  updateExtractionsList(extractions) {
    const extractionsList = document.getElementById('extractions-list');
    const extractionResults = document.getElementById('extraction-results');
    
    if (!extractionsList) return;
    
    if (!extractions || extractions.length === 0) {
      extractionsList.innerHTML = '<div class="loading">No extractions found for this project.</div>';
      if (extractionResults) extractionResults.classList.add('hidden');
      return;
    }
    
    extractionsList.innerHTML = '';
    extractions.forEach(extraction => {
      const item = document.createElement('div');
      item.className = 'extraction-item';
      
      // Format the date for display
      const extractionDate = new Date(extraction.created);
      const formattedDate = extractionDate.toLocaleDateString() + ' ' + 
                           extractionDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      item.innerHTML = `
        <div class="extraction-item-header">
          <div class="extraction-title">${extraction.collection} Extraction</div>
          <div class="extraction-date">${formattedDate}</div>
        </div>
        <div class="extraction-details">
          <p>Date Range: ${extraction.start_date || 'Unknown'} to ${extraction.end_date || 'Unknown'}</p>
          <p>Chips: ${extraction.num_chips || 0} ${extraction.chip_size ? `(${extraction.chip_size}×${extraction.chip_size} px)` : ''}</p>
          <p>File Size: ${extraction.file_size_mb} MB</p>
        </div>
        <div class="extraction-tags">
          <span class="extraction-tag">${extraction.collection}</span>
          <span class="extraction-tag">${extraction.bands ? extraction.bands.length : 'Unknown'} bands</span>
          <span class="extraction-tag">${extraction.chip_size ? extraction.chip_size : 'Unknown'}px</span>
        </div>
      `;
      
      extractionsList.appendChild(item);
    });
    
    // Show the extractions section
    if (extractionResults) extractionResults.classList.remove('hidden');
  }
  
  // Helper method to update visualization extractions
  updateVisualizationExtractions(extractions) {
    const visualizationSelect = document.getElementById('visualization-extraction');
    const noExtractions = document.getElementById('no-extractions');
    const visualizationControls = document.getElementById('visualization-controls');
    
    if (!visualizationSelect) return;
    
    if (!extractions || extractions.length === 0) {
      if (noExtractions) noExtractions.classList.remove('hidden');
      if (visualizationControls) visualizationControls.classList.add('hidden');
      visualizationSelect.innerHTML = '';
      return;
    }
    
    // Find project data files by checking the is_project_data flag or extracted_data.nc in the filename
    const projectDataFiles = extractions.filter(extraction => 
      extraction.is_project_data === true || 
      (extraction.filename && extraction.filename.includes('extracted_data.nc'))
    );
    
    if (projectDataFiles.length > 0) {
      // Hide the extraction selector and use the project data file automatically
      const container = document.getElementById('visualization-extraction-container');
      if (container) container.style.display = 'none';
      
      // Set a default value for the visualization type
      const visualizationType = document.getElementById('visualization-type');
      if (visualizationType && !visualizationType.value) {
        visualizationType.value = 'true_color';
      }
      
      // Add a hidden option with the project data file
      visualizationSelect.innerHTML = '';
      const option = document.createElement('option');
      option.value = projectDataFiles[0].filename;
      option.selected = true;
      visualizationSelect.appendChild(option);
      
      // Automatically trigger visualization load after a delay
      setTimeout(() => {
        const loadBtn = document.getElementById('load-visualization-btn');
        if (loadBtn) loadBtn.click();
      }, 500);
    } else {
      // Fall back to the dropdown selection
      const container = document.getElementById('visualization-extraction-container');
      if (container) container.style.display = 'block';
      
      // Populate extraction select
      visualizationSelect.innerHTML = '';
      extractions.forEach(extraction => {
        const option = document.createElement('option');
        option.value = extraction.filename;
        
        // Format date for display
        const extractionDate = new Date(extraction.created);
        const formattedDate = extractionDate.toLocaleDateString();
        
        option.textContent = `${extraction.collection} - ${extraction.start_date} to ${extraction.end_date} (${formattedDate})`;
        visualizationSelect.appendChild(option);
      });
    }
    
    // Show the visualization controls
    if (noExtractions) noExtractions.classList.add('hidden');
    if (visualizationControls) visualizationControls.classList.remove('hidden');
  }
  
  // Helper method to update projects list
  updateProjectsList(projects) {
    const projectsList = document.getElementById('projects-list');
    
    if (!projectsList) return;
    
    if (!projects || projects.length === 0) {
      projectsList.innerHTML = '<div class="loading">No projects found</div>';
      return;
    }
    
    projectsList.innerHTML = '';
    projects.forEach(project => {
      const projectItem = document.createElement('div');
      projectItem.className = 'project-item';
      
      // Add data badge if the project has extracted data
      const dataBadge = project.has_extracted_data ? 
        `<span class="data-badge">${project.extracted_files} extractions</span>` : '';
      
      projectItem.innerHTML = `
        <div class="project-item-name">${project.name} ${dataBadge}</div>
        <div class="project-item-info">
          <span>${project.total_points} points</span>
        </div>
      `;
      
      // Add click handler to select project
      projectItem.addEventListener('click', () => {
        this.selectProject(project.name, project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase(), project.latest_export);
      });
      
      projectsList.appendChild(projectItem);
    });
  }
  
  // Helper method to select a project
  selectProject(name, id, latestExport) {
    // Set current project in store
    store.setCurrentProject(id, name);
    
    // Load project points
    store.loadProjectPoints(latestExport);
    
    // Close project modal and open control panel
    this.closeAllPanels();
    this.openPanel('control-panel', 'point-tool-btn');
  }
  
  // Helper method to update models list
  updateModelsList(models) {
    const modelsList = document.getElementById('models-list');
    const modelsResults = document.getElementById('models-results');
    
    if (!modelsList) return;
    
    if (!models || models.length === 0) {
      modelsList.innerHTML = '<div class="loading">No models found for this project.</div>';
      if (modelsResults) modelsResults.classList.add('hidden');
      return;
    }
    
    modelsList.innerHTML = '';
    models.forEach(model => {
      const item = document.createElement('div');
      item.className = 'model-item';
      
      // Format the date for display
      const modelDate = new Date(model.created);
      const formattedDate = modelDate.toLocaleDateString() + ' ' + 
                           modelDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      item.innerHTML = `
        <div class="model-item-header">
          <div class="model-title">${model.name}</div>
          <div class="model-date">${formattedDate}</div>
        </div>
        <div class="model-details">
          <p>Input Shape: ${model.input_shape.join(' × ')}</p>
          <p>File Size: ${model.file_size_mb} MB</p>
          <p>Training Files: ${model.extraction_files.length}</p>
        </div>
        <div class="model-metrics">
          <div class="metric">
            <span class="metric-label">Accuracy:</span>
            <span class="metric-value">${(model.metrics.acc * 100).toFixed(1)}%</span>
          </div>
          <div class="metric">
            <span class="metric-label">Validation Accuracy:</span>
            <span class="metric-value">${(model.metrics.val_acc * 100).toFixed(1)}%</span>
          </div>
        </div>
      `;
      
      modelsList.appendChild(item);
    });
    
    // Show the models section
    if (modelsResults) modelsResults.classList.remove('hidden');
  }
  
  // Helper method to update training extractions
  updateTrainingExtractions(extractions) {
    const trainingSelect = document.getElementById('training-extractions');
    const noTrainingExtractions = document.getElementById('no-training-extractions');
    const trainingControls = document.getElementById('training-controls');
    
    if (!trainingSelect) return;
    
    if (!extractions || extractions.length === 0) {
      if (noTrainingExtractions) noTrainingExtractions.classList.remove('hidden');
      if (trainingControls) trainingControls.classList.add('hidden');
      trainingSelect.innerHTML = '';
      return;
    }
    
    // Find project data files by checking the is_project_data flag or extracted_data.nc in the filename
    const projectDataFiles = extractions.filter(extraction => 
      extraction.is_project_data === true || 
      (extraction.filename && extraction.filename.includes('extracted_data.nc'))
    );
    
    const trainingExtractionsContainer = document.getElementById('training-extractions-container');
    
    if (projectDataFiles.length > 0) {
      // Hide the extraction selector and use the project data file automatically
      if (trainingExtractionsContainer) trainingExtractionsContainer.style.display = 'none';
      
      // Add a hidden option with the project data file
      trainingSelect.innerHTML = '';
      const option = document.createElement('option');
      option.value = projectDataFiles[0].filename;
      option.selected = true;
      trainingSelect.appendChild(option);
      
      // Show a message about using project data
      const trainingInfo = document.querySelector('.model-training-info');
      
      // Update the train button text
      const trainButton = document.getElementById('train-btn');
      if (trainButton) {
        trainButton.textContent = 'Train Model';
      }
    } else {
      // Fall back to the dropdown selection
      if (trainingExtractionsContainer) trainingExtractionsContainer.style.display = 'block';
      
      // Populate extraction select
      trainingSelect.innerHTML = '';
      extractions.forEach(extraction => {
        const option = document.createElement('option');
        option.value = extraction.filename;
        
        // Format date for display
        const extractionDate = new Date(extraction.created);
        const formattedDate = extractionDate.toLocaleDateString();
        
        option.textContent = `${extraction.collection} - ${extraction.start_date} to ${extraction.end_date} (${formattedDate})`;
        trainingSelect.appendChild(option);
      });
    }
    
    // Show the training controls
    if (noTrainingExtractions) noTrainingExtractions.classList.add('hidden');
    if (trainingControls) trainingControls.classList.remove('hidden');
  }
  
  // Helper method to update deployment models
  updateDeploymentModels(models) {
    const modelSelect = document.getElementById('deployment-model');
    const noModelsMessage = document.getElementById('no-trained-models');
    const deploymentControls = document.getElementById('deployment-controls');
    
    if (!modelSelect) return;
    
    if (!models || models.length === 0) {
      if (noModelsMessage) noModelsMessage.classList.remove('hidden');
      if (deploymentControls) deploymentControls.classList.add('hidden');
      modelSelect.innerHTML = '<option value="">No models available</option>';
      return;
    }
    
    // Clear existing options
    modelSelect.innerHTML = '<option value="">Select a model...</option>';
    
    // Add model options
    models.forEach(model => {
      const option = document.createElement('option');
      option.value = model.name;
      option.textContent = `${model.name} (${(model.metrics.acc * 100).toFixed(1)}% accuracy)`;
      modelSelect.appendChild(option);
    });
    
    // Set the latest model as default
    if (models.length > 0) {
      modelSelect.value = models[0].name;
    }
    
    // Show the deployment controls
    if (noModelsMessage) noModelsMessage.classList.add('hidden');
    if (deploymentControls) deploymentControls.classList.remove('hidden');
  }
  
  // Helper method to set default dates
  setupDateRange(startElementId, endElementId, dayRange = 30) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - dayRange);
    
    const startElement = document.getElementById(startElementId);
    const endElement = document.getElementById(endElementId);
    
    if (startElement) {
      startElement.value = formatDate(startDate);
    }
    
    if (endElement) {
      endElement.value = formatDate(endDate);
    }
  }
  
  // Update point counts display in the control panel
  updatePointCountsDisplay(counts) {
    document.getElementById('positive-count').textContent = counts.positive;
    document.getElementById('negative-count').textContent = counts.negative;
  }
}

// Create a singleton instance
const panelManager = new PanelManager();

export { panelManager };