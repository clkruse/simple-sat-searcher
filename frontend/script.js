// API URL - using 127.0.0.1 instead of localhost
const API_URL = 'http://127.0.0.1:5001';
// Using your Mapbox access token
const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoiY2xrcnVzZSIsImEiOiJjaXIxY2M2dGcwMnNiZnZtZzN0Znk3MXRuIn0.MyKHSjxjG-ZcI2BkRUSGJA';

// Initialize Socket.IO
const socket = io(API_URL);

// Add Socket.IO connection event handlers
socket.on('connect', () => {
    console.log('Socket.IO connected with ID:', socket.id);
});

socket.on('disconnect', (reason) => {
    console.warn('Socket.IO disconnected:', reason);
});

socket.on('connect_error', (error) => {
    console.error('Socket.IO connection error:', error);
});

// Current project ID
let currentProjectId = null;
let currentProjectName = 'No Project Selected';

// Initialize map
mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/satellite-v9', // Using satellite style
    center: [-86.139373135448025, 34.303025456518071], // Default to CAFOS
    zoom: 12
});

// Store the points data
let points = [];
let pointsSource = null;

// Panel management system
const PanelManager = {
    // Store all panel IDs and their corresponding sidebar button IDs
    panels: {
        'control-panel': 'point-tool-btn',
        'extract-panel': 'extract-data-btn',
        'visualization-panel': 'visualize-data-btn',
        'project-modal': 'project-selector-btn',
        'training-panel': 'train-model-btn',
        'deployment-panel': 'deploy-model-btn',
        'map-imagery-panel': 'map-imagery-btn'
    },
    
    // Track currently active panel
    activePanel: null,
    
    // Initialize panel management system
    init() {
        // Set up event listeners for all sidebar buttons
        Object.entries(this.panels).forEach(([panelId, buttonId]) => {
            const button = document.getElementById(buttonId);
            if (button) {
                button.addEventListener('click', () => this.openPanel(panelId, buttonId));
            }
            
            // Add event listeners to all close buttons
            const panel = document.getElementById(panelId);
            if (panel) {
                const closeBtn = panel.querySelector('.close-btn');
                if (closeBtn) {
                    closeBtn.addEventListener('click', () => this.closePanel(panelId));
                }
            }
        });
        
        // Initial state - hide all panels
        this.closeAllPanels();
    },
    
    // Open a specific panel
    openPanel(panelId, buttonId) {
        // Check if project is required but not selected
        if (!currentProjectId && panelId !== 'project-modal') {
            this.openPanel('project-modal', 'project-selector-btn');
            return;
        }
        
        // For certain panels, check if points exist
        if ((panelId === 'extract-panel' || panelId === 'visualization-panel') && points.length === 0 && currentProjectId) {
            alert('Please add some points to the map first.');
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
        }
    },
    
    // Close a specific panel
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
            
            // Reset extraction progress if closing the extract panel
            if (panelId === 'extract-panel') {
                resetExtractionProgress();
            }
        }
    },
    
    // Close all panels
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
            // Remove explicit style manipulations
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
    },
    
    // Set active sidebar button
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
    },
    
    // Run panel-specific initialization when opening
    runPanelInitializer(panelId) {
        switch (panelId) {
            case 'extract-panel':
                loadExtractions();
                // Set default dates
                const today = new Date();
                const oneMonthAgo = new Date();
                oneMonthAgo.setMonth(today.getMonth() - 1);
                document.getElementById('start-date').value = formatDate(oneMonthAgo);
                document.getElementById('end-date').value = formatDate(today);
                
                // Reset extraction progress container
                resetExtractionProgress();
                
                break;
                
            case 'visualization-panel':
                loadVisualizationExtractions();
                break;
                
            case 'project-modal':
                loadProjects();
                break;
                
            case 'training-panel':
                loadTrainingExtractions();
                loadModels();
                break;
                
            case 'deployment-panel':
                loadDeploymentModels();
                // Set default dates
                const currentDate = new Date();
                const thirtyDaysAgo = new Date();
                thirtyDaysAgo.setDate(currentDate.getDate() - 30);
                document.getElementById('deployment-start-date').valueAsDate = thirtyDaysAgo;
                document.getElementById('deployment-end-date').valueAsDate = currentDate;
                break;
                
            case 'map-imagery-panel':
                // Set default dates for imagery
                const todayDate = new Date();
                const thirtyDaysBefore = new Date();
                thirtyDaysBefore.setDate(todayDate.getDate() - 30);
                document.getElementById('imagery-start-date').value = formatDate(thirtyDaysBefore);
                document.getElementById('imagery-end-date').value = formatDate(todayDate);
                break;
        }
    }
};

// Socket.IO event handlers
socket.on('connect', () => {
    console.log('Connected to WebSocket server');
});

socket.on('extraction_progress', (data) => {
    if (data.project_id === currentProjectId) {
        updateExtractionProgress(data.progress, data.current, data.total);
    }
});

socket.on('extraction_complete', (data) => {
    if (data.project_id === currentProjectId) {
        handleExtractionComplete(data);
    }
});

socket.on('extraction_error', (data) => {
    if (data.project_id === currentProjectId) {
        handleExtractionError(data.error);
    }
});

// Function to update extraction progress
function updateExtractionProgress(progress, current, total) {
    const progressBar = document.getElementById('extraction-progress');
    const progressText = document.getElementById('extraction-progress-text');
    
    if (progressBar && progressText) {
        progressBar.style.width = `${progress}%`;
        progressText.textContent = `Extracting data: ${current}/${total} points (${Math.round(progress)}%)`;
    }
}

// Function to reset the extraction progress container
function resetExtractionProgress() {
    const progressContainer = document.getElementById('extraction-progress-container');
    const progressBar = document.getElementById('extraction-progress');
    const progressText = document.getElementById('extraction-progress-text');
    
    if (progressContainer) {
        progressContainer.classList.remove('show');
        // Removing this line as it overrides the CSS class
        // progressContainer.style.display = 'none';
    }
    
    if (progressBar && progressText) {
        progressBar.style.width = '0%';
        progressText.textContent = 'Ready to extract';
    }
}

// Function to handle extraction completion
function handleExtractionComplete(data) {
    const progressContainer = document.getElementById('extraction-progress-container');
    const progressBar = document.getElementById('extraction-progress');
    const progressText = document.getElementById('extraction-progress-text');
    
    if (progressBar && progressText) {
        progressBar.style.width = '100%';
        progressText.textContent = `Extraction complete! Extracted ${data.metadata.num_chips} chips`;
        
        // Hide the progress bar after a short delay
        setTimeout(() => {
            resetExtractionProgress();
        }, 2000); // Hide after 2 seconds
        
        // Show success notification
        showNotification(`Extraction complete! Extracted ${data.metadata.num_chips} chips`, 'success');
        
        // Reload extractions list
        loadExtractions();
    }
}

// Function to handle extraction error
function handleExtractionError(error) {
    const progressContainer = document.getElementById('extraction-progress-container');
    const progressText = document.getElementById('extraction-progress-text');
    
    if (progressText) {
        progressText.textContent = `Error: ${error}`;
        
        // Hide the progress bar after a short delay
        setTimeout(() => {
            resetExtractionProgress();
        }, 3000); // Hide after 3 seconds to give user time to read the error
    }
    
    // Show error notification
    showNotification(`Error during extraction: ${error}`, 'error');
}

// Add navigation controls
map.addControl(new mapboxgl.NavigationControl({
    showCompass: false
}), 'bottom-right');

// Initialize map and add point layers
map.on('load', () => {
    // Add a source for points
    map.addSource('points', {
        'type': 'geojson',
        'data': {
            'type': 'FeatureCollection',
            'features': []
        }
    });
    
    pointsSource = map.getSource('points');
    
    // Add circle layer for positive points
    map.addLayer({
        'id': 'point-positive',
        'type': 'circle',
        'source': 'points',
        'filter': ['==', ['get', 'class'], 'positive'],
        'paint': {
            'circle-radius': 5,
            'circle-color': '#3a86ff',
            'circle-opacity': 0.9,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff'
        }
    });
    
    // Add circle layer for negative points
    map.addLayer({
        'id': 'point-negative',
        'type': 'circle',
        'source': 'points',
        'filter': ['==', ['get', 'class'], 'negative'],
        'paint': {
            'circle-radius': 5,
            'circle-color': '#ff3a5e',
            'circle-opacity': 0.9,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff'
        }
    });
    
    // Change cursor when hovering over points
    map.on('mouseenter', 'point-positive', () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    
    map.on('mouseenter', 'point-negative', () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    
    map.on('mouseleave', 'point-positive', () => {
        map.getCanvas().style.cursor = '';
    });
    
    map.on('mouseleave', 'point-negative', () => {
        map.getCanvas().style.cursor = '';
    });
    
    // Show project selection modal
    showProjectModal();
});

// Add point on click
map.on('click', (e) => {
    if (!currentProjectId) {
        showProjectModal();
        return;
    }
    
    const pointClass = document.querySelector('input[name="point-class"]:checked').value;
    addPoint(e.lngLat, pointClass);
});

// Remove point on right click
map.on('contextmenu', (e) => {
    if (!currentProjectId) {
        return;
    }
    
    // Get features at the clicked point - check only the layers that exist
    const layers = ['point-positive', 'point-negative'].filter(layerId => map.getLayer(layerId));
    
    if (layers.length === 0) {
        return; // No valid layers to query
    }
    
    const features = map.queryRenderedFeatures(e.point, {
        layers: layers
    });
    
    // If a point was clicked, remove it
    if (features.length > 0) {
        const pointId = features[0].properties.id;
        removePoint(pointId);
    }
});

// Function to add a point
function addPoint(lngLat, pointClass) {
    const pointId = Date.now();
    
    // Create a new point feature
    const point = {
        'type': 'Feature',
        'geometry': {
            'type': 'Point',
            'coordinates': [lngLat.lng, lngLat.lat]
        },
        'properties': {
            'id': pointId,
            'class': pointClass
        }
    };
    
    // Add to points array
    points.push(point);
    
    // Update the map source data
    updatePointsOnMap();
    
    // Update stats
    updatePointCounts();
    
    // Automatically export points if we have a project selected
    if (currentProjectId) {
        exportPointsToBackend(false);
    }
}

// Function to remove a point
function removePoint(pointId) {
    // Find the point index
    const pointIndex = points.findIndex(p => p.properties.id === pointId);
    
    if (pointIndex === -1) {
        return;
    }
    
    // Get point class for the notification
    const pointClass = points[pointIndex].properties.class;
    
    // Remove the point
    points.splice(pointIndex, 1);
    
    // Update the map source data
    updatePointsOnMap();
    
    // Update stats
    updatePointCounts();
    
    // Export updated points to backend
    if (currentProjectId) {
        exportPointsToBackend(false)
            .then(() => {
                // Show notification with more details
                showNotification(`Removed ${pointClass} point and associated data`, 'success');
            })
            .catch(error => {
                console.error('Error exporting points after removal:', error);
                showNotification('Point removed, but there was an error updating data', 'warning');
            });
    } else {
        // Show simple notification if no project
        showNotification('Point removed', 'success');
    }
}

// Update points on the map
function updatePointsOnMap() {
    if (pointsSource) {
        pointsSource.setData({
            'type': 'FeatureCollection',
            'features': points
        });
    }
}

// Update the counts of positive and negative points
function updatePointCounts() {
    const positiveCount = points.filter(p => p.properties.class === 'positive').length;
    const negativeCount = points.filter(p => p.properties.class === 'negative').length;
    
    document.getElementById('positive-count').textContent = positiveCount;
    document.getElementById('negative-count').textContent = negativeCount;
}

// Convert points to GeoJSON format for export
function pointsToGeoJSON() {
    return {
        type: 'FeatureCollection',
        features: points
    };
}

// Export points to backend without notifications
async function exportPointsToBackend(showNotifications = true) {
    if (!currentProjectId) {
        if (showNotifications) {
            showProjectModal();
        }
        return Promise.reject(new Error('No project selected'));
    }
    
    if (points.length === 0) {
        if (showNotifications) {
            alert('No points to export.');
        }
        return Promise.resolve({ success: true, message: 'No points to export' });
    }
    
    const geoJSON = pointsToGeoJSON();
    
    try {
        const response = await fetch(`${API_URL}/export_points`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ 
                geojson: geoJSON,
                project_id: currentProjectId
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            if (showNotifications) {
                const total = geoJSON.features.length;
                const positiveCount = points.filter(p => p.properties.class === 'positive').length;
                const negativeCount = points.filter(p => p.properties.class === 'negative').length;
                
                alert(`Exported ${total} points (${positiveCount} positive, ${negativeCount} negative)`);
            }
            return data;
        } else {
            if (showNotifications) {
                alert('Error: ' + data.message);
            }
            return Promise.reject(new Error(data.message));
        }
    } catch (error) {
        if (showNotifications) {
            alert('Connection error: ' + error.message);
        }
        return Promise.reject(error);
    }
}

// Export points to backend (with notifications) - for the button
// Note: Button may not exist in the DOM as it's been removed from the UI
const exportButton = document.getElementById('export-points-btn');
if (exportButton) {
    exportButton.addEventListener('click', () => {
        exportPointsToBackend(true);
    });
}

// Clear all points
document.getElementById('clear-btn').addEventListener('click', () => {
    if (points.length === 0) return;
    
    if (confirm('Clear all points?')) {
        points = [];
        updatePointsOnMap();
        updatePointCounts();
    }
});

// Show project selection modal - use PanelManager
function showProjectModal() {
    PanelManager.openPanel('project-modal', 'project-selector-btn');
}

// Close all panels - use PanelManager
function closeAllPanels() {
    PanelManager.closeAllPanels();
}

// Create a new project
document.getElementById('create-project-btn').addEventListener('click', async () => {
    const projectName = document.getElementById('new-project-name').value.trim();
    
    if (!projectName) {
        alert('Please enter a project name.');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/create_project`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: projectName })
        });
        
        const data = await response.json();
        
        if (data.success) {
            selectProject(projectName, data.project_id);
        } else {
            alert('Error: ' + data.message);
        }
    } catch (error) {
        alert('Connection error: ' + error.message);
    }
});

// Load saved points for a project
async function loadProjectPoints(projectId, latestExport = 'points.geojson') {
    try {
        // Always use points.geojson as the default if not specified
        const filename = latestExport || 'points.geojson';
        const response = await fetch(`${API_URL}/load_points?project_id=${projectId}&filename=${filename}`);
        const data = await response.json();
        
        if (data.success && data.geojson && data.geojson.features) {
            // Load points from the GeoJSON data
            points = data.geojson.features;
            
            // Update the map and counts
            updatePointsOnMap();
            updatePointCounts();
            
            // Zoom to the points if any exist
            if (points.length > 0) {
                fitMapToPoints();
            }
        }
    } catch (error) {
        console.error('Error loading project points:', error);
    }
}

// Fit map view to the current points
function fitMapToPoints() {
    if (points.length === 0) return;
    
    // Get bounds of all points
    const bounds = new mapboxgl.LngLatBounds();
    
    points.forEach(point => {
        const coordinates = point.geometry.coordinates;
        bounds.extend([coordinates[0], coordinates[1]]);
    });
    
    // Fit the map to the bounds
    map.fitBounds(bounds, {
        padding: 100,
        maxZoom: 15
    });
}

// Select a project
function selectProject(projectName, projectId = null, latestExport = null) {
    // If projectId is not provided, create a safe ID from the name
    if (!projectId) {
        projectId = projectName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    }
    
    currentProjectId = projectId;
    currentProjectName = projectName;
    
    // Update UI
    document.getElementById('project-name').textContent = projectName;
    
    // Reset points
    points = [];
    updatePointsOnMap();
    updatePointCounts();
    
    // Always load points - will default to points.geojson
    loadProjectPoints(projectId, latestExport);
    
    // Close modal and open control panel
    PanelManager.closeAllPanels();
    PanelManager.openPanel('control-panel', 'point-tool-btn');
}

// Format date as YYYY-MM-DD
function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Update threshold value display
document.getElementById('clear-threshold').addEventListener('input', (e) => {
    document.getElementById('threshold-value').textContent = e.target.value;
});

// Update the extract data function
document.getElementById('extract-btn').addEventListener('click', async () => {
    if (!currentProjectId) {
        showProjectModal();
        return;
    }
    
    const collection = document.getElementById('collection-select').value;
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const chipSize = parseInt(document.getElementById('chip-size').value);
    const clearThreshold = parseFloat(document.getElementById('clear-threshold').value);
    
    if (!startDate || !endDate) {
        alert('Please select start and end dates');
        return;
    }
    
    // Show and reset progress bar
    const progressContainer = document.getElementById('extraction-progress-container');
    const progressBar = document.getElementById('extraction-progress');
    const progressText = document.getElementById('extraction-progress-text');
    
    if (progressContainer) {
        progressContainer.classList.add('show');
    }
    
    if (progressBar && progressText) {
        progressBar.style.width = '0%';
        progressText.textContent = 'Starting extraction...';
    }
    
    try {
        const response = await fetch(`${API_URL}/extract_data`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                project_id: currentProjectId,
                collection: collection,
                start_date: startDate,
                end_date: endDate,
                chip_size: chipSize,
                clear_threshold: clearThreshold
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            alert('Error: ' + data.message);
        }
    } catch (error) {
        alert('Connection error: ' + error.message);
    }
});

// Load extractions for the current project
async function loadExtractions() {
    if (!currentProjectId) return;
    
    const extractionsList = document.getElementById('extractions-list');
    extractionsList.innerHTML = '<div class="loading">Loading extractions...</div>';
    
    try {
        const response = await fetch(`${API_URL}/list_extracted_data?project_id=${currentProjectId}`);
        const data = await response.json();
        
        if (data.success) {
            if (data.extractions.length === 0) {
                extractionsList.innerHTML = '<div class="loading">No extractions found for this project.</div>';
                document.getElementById('extraction-results').classList.add('hidden');
            } else {
                extractionsList.innerHTML = '';
                
                data.extractions.forEach(extraction => {
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
                document.getElementById('extraction-results').classList.remove('hidden');
            }
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        console.error('Error loading extractions:', error);
        extractionsList.innerHTML = `<div class="loading">Error loading extractions: ${error.message}</div>`;
    }
}

// Load projects from backend
async function loadProjects() {
    const projectsList = document.getElementById('projects-list');
    projectsList.innerHTML = '<div class="loading">Loading projects...</div>';
    
    try {
        const response = await fetch(`${API_URL}/list_projects`);
        const data = await response.json();
        
        if (data.success) {
            if (data.projects.length === 0) {
                projectsList.innerHTML = '<div class="loading">No projects found</div>';
            } else {
                projectsList.innerHTML = '';
                
                data.projects.forEach(project => {
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
                    
                    projectItem.addEventListener('click', () => {
                        selectProject(project.name, project.name.replace(/[^a-z0-9]/gi, '_').toLowerCase(), project.latest_export);
                    });
                    
                    projectsList.appendChild(projectItem);
                });
            }
        } else {
            projectsList.innerHTML = `<div class="loading">Error: ${data.message}</div>`;
        }
    } catch (error) {
        projectsList.innerHTML = `<div class="loading">Connection error</div>`;
    }
}

// Map overlay for patches
let patchOverlays = [];
let patchLayers = [];
let patchSources = [];

// Load extractions for visualization
async function loadVisualizationExtractions() {
    const visualizationSelect = document.getElementById('visualization-extraction');
    visualizationSelect.innerHTML = '<option value="">Loading...</option>';
    
    console.log("Loading visualization extractions for project:", currentProjectId);
    
    // Check for unified data files
    try {
        const response = await fetch(`${API_URL}/list_extracted_data?project_id=${currentProjectId}`);
        const data = await response.json();
        
        console.log("Visualization extraction response:", data);
        
        if (data.success) {
            if (data.extractions.length === 0) {
                // No extractions available
                console.log("No extractions found for visualization");
                document.getElementById('no-extractions').classList.remove('hidden');
                document.getElementById('visualization-controls').classList.add('hidden');
                visualizationSelect.innerHTML = '';
            } else {
                document.getElementById('no-extractions').classList.add('hidden');
                document.getElementById('visualization-controls').classList.remove('hidden');
                
                // Find unified files by checking the unified flag or extracted_data.nc in the filename
                const unifiedExtractions = data.extractions.filter(extraction => 
                    extraction.unified === true || 
                    (extraction.filename && extraction.filename.includes('extracted_data.nc'))
                );
                
                console.log("Unified extractions found:", unifiedExtractions);
                
                if (unifiedExtractions.length > 0) {
                    // Hide the extraction selector and use the unified file automatically
                    document.getElementById('visualization-extraction-container').style.display = 'none';
                    
                    // Set a default value for the visualization type
                    const visualizationType = document.getElementById('visualization-type');
                    if (!visualizationType.value) {
                        visualizationType.value = 'true_color';
                    }
                    
                    // Automatically load visualization with the unified file
                    const unifiedFile = unifiedExtractions[0].filename;
                    console.log("Using file for visualization:", unifiedFile);
                    
                    // Add a hidden option with the unified file
                    visualizationSelect.innerHTML = '';
                    const option = document.createElement('option');
                    option.value = unifiedFile;
                    option.selected = true;
                    visualizationSelect.appendChild(option);
                    
                    // Show clear button if there are overlays
                    if (patchOverlays.length > 0) {
                        document.getElementById('clear-visualization-btn').classList.remove('hidden');
                    } else {
                        document.getElementById('clear-visualization-btn').classList.add('hidden');
                    }
                    
                    // Automatically load the visualization when the type changes
                    document.getElementById('visualization-type').addEventListener('change', function() {
                        document.getElementById('load-visualization-btn').click();
                    });
                    
                    // Automatically trigger visualization load
                    setTimeout(() => {
                        document.getElementById('load-visualization-btn').click();
                    }, 500);
                } else {
                    console.log("No unified extractions found, using dropdown selection");
                    // Fall back to the old dropdown selection for backward compatibility
                    document.getElementById('visualization-extraction-container').style.display = 'block';
                    
                    // Populate extraction select
                    visualizationSelect.innerHTML = '';
                    data.extractions.forEach(extraction => {
                        const option = document.createElement('option');
                        option.value = extraction.filename;
                        
                        // Format date for display
                        const extractionDate = new Date(extraction.created);
                        const formattedDate = extractionDate.toLocaleDateString();
                        
                        option.textContent = `${extraction.collection} - ${extraction.start_date} to ${extraction.end_date} (${formattedDate})`;
                        visualizationSelect.appendChild(option);
                    });
                    
                    // Show clear button if there are overlays
                    if (patchOverlays.length > 0) {
                        document.getElementById('clear-visualization-btn').classList.remove('hidden');
                    } else {
                        document.getElementById('clear-visualization-btn').classList.add('hidden');
                    }
                }
            }
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        console.error('Error loading extractions for visualization:', error);
        visualizationSelect.innerHTML = `<option value="">Error: ${error.message}</option>`;
    }
}

// Load visualization button
document.getElementById('load-visualization-btn').addEventListener('click', async () => {
    const extractionFile = document.getElementById('visualization-extraction').value;
    const visualizationType = document.getElementById('visualization-type').value;
    
    if (!extractionFile) {
        alert('Please select an extraction to visualize.');
        return;
    }
    
    // Show loading status
    document.getElementById('visualization-status').classList.remove('hidden');
    document.getElementById('visualization-controls').classList.add('hidden');
    document.getElementById('visualization-info').classList.add('hidden');
    
    try {
        // Clear any existing overlays
        clearPatchOverlays();
        
        // Fetch visualization data
        const response = await fetch(`${API_URL}/get_patch_visualization?project_id=${currentProjectId}&file=${extractionFile}&vis_type=${visualizationType}`);
        const data = await response.json();
        
        if (data.success) {
            // Display patches on the map
            displayPatchesOnMap(data.patches, visualizationType);
            
            // Update visualization info
            document.getElementById('vis-collection').textContent = data.collection;
            document.getElementById('vis-patches').textContent = data.patches.length;
            document.getElementById('vis-mode').textContent = getVisualizeTypeLabel(visualizationType);
            
            // Update legend
            updateLegend(visualizationType, data.collection);
            
            // Show info
            document.getElementById('visualization-info').classList.remove('hidden');
            
            // Fit map to all patches
            fitMapToPatches(data.patches);
            
            // Show clear button
            document.getElementById('clear-visualization-btn').classList.remove('hidden');
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        console.error('Error loading visualization:', error);
        alert(`Error loading visualization: ${error.message}`);
    } finally {
        // Hide loading, show controls
        document.getElementById('visualization-status').classList.add('hidden');
        document.getElementById('visualization-controls').classList.remove('hidden');
    }
});

// Clear visualization button
document.getElementById('clear-visualization-btn').addEventListener('click', () => {
    clearPatchOverlays();
    document.getElementById('visualization-info').classList.add('hidden');
    document.getElementById('clear-visualization-btn').classList.add('hidden');
});

// Display patches on the map with geographic scaling
function displayPatchesOnMap(patches, visualizationType) {
    // Clear any existing overlays first
    clearPatchOverlays();
    
    patches.forEach((patch, index) => {
        // Get coordinates
        const lon = patch.longitude;
        const lat = patch.latitude;
        
        // Create a unique ID for this patch
        const patchId = `patch-${Date.now()}-${index}`;
        const sourceId = `source-${patchId}`;
        const layerId = `layer-${patchId}`;
        
        // Calculate the geographic bounds of the patch
        // For Sentinel-2, each pixel is approximately 10m x 10m
        const pixelSize = 10; // meters
        const chipSizeMeters = patch.chip_size * pixelSize;
        const offsetMeters = chipSizeMeters / 2;
        
        // Calculate bounding coordinates (approximate)
        // Convert meters to approximate degrees at this latitude
        // 111,320 meters = 1 degree of latitude
        // 111,320 * cos(latitude) meters = 1 degree of longitude
        const metersPerDegreeLat = 111320;
        const metersPerDegreeLon = 111320 * Math.cos(lat * Math.PI / 180);
        
        const offsetLat = offsetMeters / metersPerDegreeLat;
        const offsetLon = offsetMeters / metersPerDegreeLon;
        
        const bounds = [
            [lon - offsetLon, lat - offsetLat], // Southwest corner
            [lon + offsetLon, lat + offsetLat]  // Northeast corner
        ];
        
        // Add the image as a raster source to the map
        map.addSource(sourceId, {
            'type': 'image',
            'url': `data:image/png;base64,${patch.image}`,
            'coordinates': [
                [bounds[0][0], bounds[1][1]], // Top left (NW)
                [bounds[1][0], bounds[1][1]], // Top right (NE)
                [bounds[1][0], bounds[0][1]], // Bottom right (SE)
                [bounds[0][0], bounds[0][1]]  // Bottom left (SW)
            ]
        });
        patchSources.push(sourceId);
        
        // Add the image as a raster layer
        map.addLayer({
            'id': layerId,
            'type': 'raster',
            'source': sourceId,
            'paint': {
                'raster-opacity': 1.0,
                'raster-fade-duration': 0
            },
            'layout': {
                'visibility': 'visible'
            }
        });
        patchLayers.push(layerId);
        
        // Add a small marker at the center point to show the label (positive/negative)
        const el = document.createElement('div');
        el.className = `patch-marker patch-${patch.label}`;
        
        // Create the marker
        const marker = new mapboxgl.Marker({
            element: el,
            anchor: 'center',
            scale: 0.6
        })
        .setLngLat([lon, lat])
        .addTo(map);
        
        // Add popup with metadata
        const popup = new mapboxgl.Popup({
            closeButton: false,
            maxWidth: '200px'
        })
        .setHTML(`
            <div class="patch-popup">
                <img src="data:image/png;base64,${patch.image}" class="patch-popup-image" style="width: 100px;">
                <div class="patch-popup-info">
                    <span class="patch-popup-label">Class: ${patch.label}</span>
                    <span class="patch-popup-coords">
                        ${lat.toFixed(6)}, ${lon.toFixed(6)}
                    </span>
                </div>
                <div class="patch-popup-meta">
                    <span>Coverage: ~${chipSizeMeters}m × ${chipSizeMeters}m</span>
                </div>
            </div>
        `);
        
        // Show popup on hover
        el.addEventListener('mouseenter', () => {
            marker.setPopup(popup);
            popup.addTo(map);
        });
        
        el.addEventListener('mouseleave', () => {
            popup.remove();
        });
        
        // Track the marker for later removal
        patchOverlays.push(marker);
    });
}

// Update the clear overlay function
function clearPatchOverlays() {
    // Remove all markers
    patchOverlays.forEach(marker => marker.remove());
    patchOverlays = [];
    
    // Remove all layers and sources
    patchLayers.forEach(layerId => {
        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
    });
    patchLayers = [];
    
    patchSources.forEach(sourceId => {
        if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
        }
    });
    patchSources = [];
}

// Fit map to all patches
function fitMapToPatches(patches) {
    if (patches.length === 0) return;
    
    const bounds = new mapboxgl.LngLatBounds();
    
    patches.forEach(patch => {
        bounds.extend([patch.longitude, patch.latitude]);
    });
    
    map.fitBounds(bounds, {
        padding: 100,
        maxZoom: 15
    });
}

// Update legend based on visualization type
function updateLegend(visualizationType, collection) {
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
                    <span>-1</span>
                    <span>0</span>
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

// Get a human-readable label for visualization type
function getVisualizeTypeLabel(visualizationType) {
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

// Socket.IO event handlers for training
socket.on('training_progress', (data) => {
    console.log('Received training_progress event:', data);
    if (data.project_id === currentProjectId) {
        updateTrainingProgress(data);
    } else {
        console.log('Ignoring training_progress event for different project:', data.project_id, 'current:', currentProjectId);
    }
});

socket.on('training_complete', (data) => {
    console.log('Received training_complete event:', data);
    if (data.project_id === currentProjectId) {
        handleTrainingComplete(data);
    } else {
        console.log('Ignoring training_complete event for different project:', data.project_id, 'current:', currentProjectId);
    }
});

socket.on('training_error', (data) => {
    console.log('Received training_error event:', data);
    if (data.project_id === currentProjectId) {
        handleTrainingError(data.error);
    } else {
        console.log('Ignoring training_error event for different project:', data.project_id, 'current:', currentProjectId);
    }
});

// Function to update training progress
function updateTrainingProgress(data) {
    console.log('Updating training progress with data:', data);
    
    const progressBar = document.getElementById('training-progress');
    const progressText = document.getElementById('training-progress-text');
    const metricsText = document.getElementById('training-metrics');
    const trainingAccuracyBar = document.getElementById('training-accuracy-bar');
    const validationAccuracyBar = document.getElementById('validation-accuracy-bar');
    const trainingAccuracyValue = document.getElementById('training-accuracy-value');
    const validationAccuracyValue = document.getElementById('validation-accuracy-value');
    
    if (!progressBar || !progressText) {
        console.error('Missing progress elements:', { progressBar, progressText });
        return;
    }
    
    progressBar.style.width = `${data.progress}%`;
    progressText.textContent = `Training model: Epoch ${data.current_epoch}/${data.total_epochs} (${Math.round(data.progress)}%)`;
    
    // Update the progress bar color based on progress
    if (data.progress < 25) {
        progressBar.style.backgroundColor = '#3498db'; // Blue
    } else if (data.progress < 75) {
        progressBar.style.backgroundColor = '#2ecc71'; // Green
    } else {
        progressBar.style.backgroundColor = '#27ae60'; // Darker green
    }
    
    // Check if logs are available
    if (!data.logs) {
        console.warn('No logs data available in training progress update');
        return;
    }
    
    
    if (trainingAccuracyBar && validationAccuracyBar) {
        const trainingAccuracy = (data.logs.accuracy * 100) || (data.logs.acc * 100) || 0;
        const validationAccuracy = (data.logs.val_accuracy * 100) || (data.logs.val_acc * 100) || 0;
        
        trainingAccuracyBar.style.width = `${trainingAccuracy}%`;
        validationAccuracyBar.style.width = `${validationAccuracy}%`;
        
        trainingAccuracyValue.textContent = `${trainingAccuracy.toFixed(1)}%`;
        validationAccuracyValue.textContent = `${validationAccuracy.toFixed(1)}%`;
        
        // Color training accuracy bar based on value
        if (trainingAccuracy < 50) {
            trainingAccuracyBar.style.backgroundColor = '#e74c3c'; // Red
        } else if (trainingAccuracy < 75) {
            trainingAccuracyBar.style.backgroundColor = '#f39c12'; // Orange
        } else if (trainingAccuracy < 90) {
            trainingAccuracyBar.style.backgroundColor = '#2ecc71'; // Green
        } else {
            trainingAccuracyBar.style.backgroundColor = '#27ae60'; // Darker green
        }
        
        // Color validation accuracy bar based on value
        if (validationAccuracy < 50) {
            validationAccuracyBar.style.backgroundColor = '#e74c3c'; // Red
        } else if (validationAccuracy < 75) {
            validationAccuracyBar.style.backgroundColor = '#f39c12'; // Orange
        } else if (validationAccuracy < 90) {
            validationAccuracyBar.style.backgroundColor = '#3498db'; // Blue
        } else {
            validationAccuracyBar.style.backgroundColor = '#2980b9'; // Darker blue
        }
    } else {
        console.warn('Missing accuracy bar elements:', { trainingAccuracyBar, validationAccuracyBar });
    }
    
    if (metricsText) {
        // Extract metrics from logs, using fallbacks for different naming conventions
        const loss = data.logs.loss || 0;
        const acc = data.logs.accuracy || data.logs.acc || 0;
        const val_loss = data.logs.val_loss || 0;
        const val_acc = data.logs.val_accuracy || data.logs.val_acc || 0;
        
        metricsText.innerHTML = `
            <div class="metrics-container">
                <div class="metric">
                    <span class="metric-label">Loss:</span>
                    <span class="metric-value">${loss.toFixed(4)}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Accuracy:</span>
                    <span class="metric-value">${(acc * 100).toFixed(1)}%</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Validation Loss:</span>
                    <span class="metric-value">${val_loss.toFixed(4)}</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Validation Accuracy:</span>
                    <span class="metric-value">${(val_acc * 100).toFixed(1)}%</span>
                </div>
            </div>
        `;
    } else {
        console.warn('Missing metrics text element:', metricsText);
    }
}

// Function to handle training completion
function handleTrainingComplete(data) {
    const progressBar = document.getElementById('training-progress');
    const progressText = document.getElementById('training-progress-text');
    const trainingAccuracyBar = document.getElementById('training-accuracy-bar');
    const validationAccuracyBar = document.getElementById('validation-accuracy-bar');
    const trainingAccuracyValue = document.getElementById('training-accuracy-value');
    const validationAccuracyValue = document.getElementById('validation-accuracy-value');
    const metricsText = document.getElementById('training-metrics');
    const progressContainer = document.getElementById('training-status').querySelector('.progress-container');
    
    if (progressBar && progressText) {
        // Set to 100% complete
        progressBar.style.width = '100%';
        progressBar.style.backgroundColor = '#27ae60'; // Dark green for completion
        
        // Get accuracy from metrics, handling different naming conventions
        const finalAcc = data.metrics.accuracy || data.metrics.acc || 0;
        const finalValAcc = data.metrics.val_accuracy || data.metrics.val_acc || 0;
        progressText.textContent = `Training complete! Final accuracy: ${(finalAcc * 100).toFixed(1)}%`;
        
        // Stop the animation
        progressBar.classList.add('complete');
        if (progressContainer) {
            progressContainer.classList.add('complete');
        }
        
        // Update accuracy bars to final values
        if (trainingAccuracyBar && validationAccuracyBar) {
            const trainingAccuracy = (data.metrics.accuracy || data.metrics.acc || 0) * 100;
            const validationAccuracy = (data.metrics.val_accuracy || data.metrics.val_acc || 0) * 100;
            
            trainingAccuracyBar.style.width = `${trainingAccuracy}%`;
            validationAccuracyBar.style.width = `${validationAccuracy}%`;
            
            trainingAccuracyValue.textContent = `${trainingAccuracy.toFixed(1)}%`;
            validationAccuracyValue.textContent = `${validationAccuracy.toFixed(1)}%`;
            
            // Set final colors based on accuracy
            trainingAccuracyBar.style.backgroundColor = trainingAccuracy >= 90 ? '#27ae60' : '#2ecc71';
            validationAccuracyBar.style.backgroundColor = validationAccuracy >= 90 ? '#2980b9' : '#3498db';
        }
        
        // Re-enable the train button
        document.getElementById('train-btn').disabled = false;
        
        // Reload models list
        loadModels();
        
        // Show success message
        showNotification(`Model '${data.model_name}' trained successfully! Final accuracy: ${(finalValAcc * 100).toFixed(1)}%`, 'success');
        
        // After a delay, fade out the progress display
        setTimeout(() => {
            if (progressContainer) {
                progressContainer.style.opacity = '0.6';
            }
        }, 3000);
    }
}

// Function to handle training error
function handleTrainingError(error) {
    const progressText = document.getElementById('training-progress-text');
    const progressBar = document.getElementById('training-progress');
    const progressContainer = document.getElementById('training-status').querySelector('.progress-container');
    
    if (progressText) {
        progressText.textContent = `Error: ${error}`;
        
        if (progressBar) {
            progressBar.style.backgroundColor = '#e74c3c'; // Red for error
            progressBar.classList.add('complete'); // Stop animation
        }
        
        if (progressContainer) {
            progressContainer.classList.add('complete');
        }
        
        // Re-enable the train button
        document.getElementById('train-btn').disabled = false;
        
        // Show error notification
        showNotification(`Training error: ${error}`, 'error');
    }
}

// Train model button
document.getElementById('train-btn').addEventListener('click', async () => {
    if (!currentProjectId) {
        showProjectModal();
        return;
    }
    
    // Check if model name element exists
    const modelNameElement = document.getElementById('model-name');
    if (!modelNameElement) {
        console.error("Model name input element not found");
        return;
    }
    
    const modelName = modelNameElement.value.trim();
    
    // Check if we're using unified data (dropdown is hidden)
    const trainingExtractionsContainer = document.getElementById('training-extractions-container');
    const isUsingUnifiedData = trainingExtractionsContainer && 
                              (trainingExtractionsContainer.style.display === 'none' || 
                               trainingExtractionsContainer.classList.contains('hidden'));
    
    let selectedExtractions = [];
    
    if (isUsingUnifiedData) {
        // When using unified data, get the value directly from the hidden select element
        const trainingSelect = document.getElementById('training-extractions');
        if (trainingSelect && trainingSelect.options && trainingSelect.options.length > 0) {
            selectedExtractions = [trainingSelect.options[0].value];
        } else {
            // Try to find a unified file
            const unifiedFile = Array.from(document.querySelectorAll('.model-training-info'))
                .filter(el => el && el.textContent && el.textContent.includes('unified'))
                .map(() => {
                    // Look for any unified file
                    const files = Array.from(document.querySelectorAll('option'))
                        .filter(opt => opt && opt.value && opt.value.includes('extracted_data.nc'))
                        .map(opt => opt.value);
                    return files.length > 0 ? files[0] : null;
                })
                .filter(Boolean)[0];
                
            if (unifiedFile) {
                selectedExtractions = [unifiedFile];
            }
        }
        
        // If we still don't have a file, let the backend find it
        if (selectedExtractions.length === 0) {
            console.log("No specific extraction file found, using auto_detect");
            selectedExtractions = ['auto_detect'];
        }
    } else {
        // Normal mode: get selected options from the dropdown with safety checks
        const trainingSelect = document.getElementById('training-extractions');
        if (trainingSelect && trainingSelect.selectedOptions) {
            selectedExtractions = Array.from(trainingSelect.selectedOptions)
                .map(option => option.value);
        } else {
            console.log("Training select not found or has no selectedOptions, using auto_detect");
            selectedExtractions = ['auto_detect'];
        }
    }
    
    if (!modelName) {
        alert('Please enter a model name');
        return;
    }
    
    // Get form values with safety checks
    let batchSize = 32;
    let epochs = 10;
    let testSplit = 0.3;
    let useAugmentation = true;
    
    const batchSizeElement = document.getElementById('batch-size');
    if (batchSizeElement) {
        batchSize = parseInt(batchSizeElement.value) || 32;
    }
    
    const epochsElement = document.getElementById('epochs');
    if (epochsElement) {
        epochs = parseInt(epochsElement.value) || 10;
    }
    
    const testSplitElement = document.getElementById('test-split');
    if (testSplitElement) {
        testSplit = parseFloat(testSplitElement.value) || 0.3;
    }
    
    const useAugmentationElement = document.getElementById('use-augmentation');
    if (useAugmentationElement) {
        useAugmentation = useAugmentationElement.checked;
    }
    
    // Reset progress UI with safety checks
    const progressBar = document.getElementById('training-progress');
    const progressText = document.getElementById('training-progress-text');
    const trainingAccuracyBar = document.getElementById('training-accuracy-bar');
    const validationAccuracyBar = document.getElementById('validation-accuracy-bar');
    const trainingAccuracyValue = document.getElementById('training-accuracy-value');
    const validationAccuracyValue = document.getElementById('validation-accuracy-value');
    const metricsText = document.getElementById('training-metrics');
    
    if (progressBar && progressText) {
        progressBar.style.width = '0%';
        progressBar.style.backgroundColor = '#3498db'; // Reset to blue
        progressText.textContent = 'Starting training...';
    }
    
    // Reset accuracy bars if they exist
    if (trainingAccuracyBar && validationAccuracyBar) {
        trainingAccuracyBar.style.width = '0%';
        validationAccuracyBar.style.width = '0%';
        if (trainingAccuracyValue) trainingAccuracyValue.textContent = '0.0%';
        if (validationAccuracyValue) validationAccuracyValue.textContent = '0.0%';
    }
    
    // Reset metrics if element exists
    if (metricsText) {
        metricsText.innerHTML = '';
    }
    
    // Show status panel if it exists
    const trainingStatus = document.getElementById('training-status');
    if (trainingStatus) {
        trainingStatus.classList.remove('hidden');
    }
    
    // Disable train button
    const trainBtn = document.getElementById('train-btn');
    if (trainBtn) {
        trainBtn.disabled = true;
    }
    
    try {
        const response = await fetch(`${API_URL}/train_model`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                project_id: currentProjectId,
                model_name: modelName,
                extraction_files: selectedExtractions,
                batch_size: batchSize,
                epochs: epochs,
                test_split: testSplit,
                augmentation: useAugmentation
            })
        });
        
        const data = await response.json();
        
        if (!data.success) {
            alert('Error: ' + data.message);
            // Re-enable train button on error
            if (trainBtn) {
                trainBtn.disabled = false;
            }
        } else {
            console.log("Training started successfully");
        }
    } catch (error) {
        console.error("Error starting training:", error);
        alert('Connection error: ' + error.message);
        // Re-enable train button on error
        if (trainBtn) {
            trainBtn.disabled = false;
        }
    }
});

// Load extractions for training
async function loadTrainingExtractions() {
    // Add safety check to ensure elements exist
    const trainingSelect = document.getElementById('training-extractions');
    if (!trainingSelect) {
        console.error("Element 'training-extractions' not found");
        return;
    }

    // Set loading message only if element exists
    trainingSelect.innerHTML = '<option value="">Loading...</option>';
    
    console.log("Loading training extractions for project:", currentProjectId);
    
    // If no project is selected, we can't load anything
    if (!currentProjectId) {
        console.error("No project selected, cannot load training extractions");
        return;
    }
    
    // Special case - directly check if any unified file exists (any file with extracted_data.nc)
    try {
        const response = await fetch(`${API_URL}/list_extracted_data?project_id=${currentProjectId}`);
        const data = await response.json();
        
        console.log("Training extraction response:", data);
        
        // Get DOM elements with null checks
        const noTrainingExtractionsEl = document.getElementById('no-training-extractions');
        const trainingControlsEl = document.getElementById('training-controls');
        
        if (!data.success) {
            console.error("Failed to fetch extraction data:", data.message);
            if (trainingSelect) trainingSelect.innerHTML = `<option value="">Error: ${data.message}</option>`;
            return;
        }
        
        if (data.extractions.length === 0) {
            // No extractions available
            console.log("No extractions found for training");
            if (noTrainingExtractionsEl) noTrainingExtractionsEl.classList.remove('hidden');
            if (trainingControlsEl) trainingControlsEl.classList.add('hidden');
            if (trainingSelect) trainingSelect.innerHTML = '';
        } else {
            if (noTrainingExtractionsEl) noTrainingExtractionsEl.classList.add('hidden');
            if (trainingControlsEl) trainingControlsEl.classList.remove('hidden');
            
            // Find unified files by checking the unified flag or the filename
            const unifiedExtractions = data.extractions.filter(extraction => 
                extraction.unified === true || 
                (extraction.filename && extraction.filename.includes('extracted_data.nc'))
            );
            
            console.log("Unified training extractions found:", unifiedExtractions);
            
            const trainingExtractionsContainer = document.getElementById('training-extractions-container');
            
            if (unifiedExtractions.length > 0) {
                // Hide the extraction selector and use the unified file automatically
                if (trainingExtractionsContainer) trainingExtractionsContainer.style.display = 'none';
                
                // Automatically use the unified file
                const unifiedFile = unifiedExtractions[0].filename;
                console.log("Using unified file for training:", unifiedFile);
                
                // Add a hidden option with the unified file
                if (trainingSelect) {
                    trainingSelect.innerHTML = '';
                    const option = document.createElement('option');
                    option.value = unifiedFile;
                    option.selected = true;
                    trainingSelect.appendChild(option);
                }
                
                // Show a message about using unified data
                const trainingInfo = document.querySelector('.model-training-info');
                if (trainingInfo) {
                    trainingInfo.textContent = 'Using unified project data for training';
                    trainingInfo.style.display = 'block';
                    trainingInfo.style.fontWeight = 'bold';
                    trainingInfo.style.marginBottom = '15px';
                    trainingInfo.style.color = '#2c7be5';
                }
                
                // Update the train button text
                const trainButton = document.getElementById('train-btn');
                if (trainButton) {
                    trainButton.textContent = 'Train Model on Unified Data';
                }
            } else {
                console.log("No unified extractions found for training, using dropdown selection");
                // Fall back to the old dropdown selection for backward compatibility
                if (trainingExtractionsContainer) trainingExtractionsContainer.style.display = 'block';
                
                // Populate extraction select
                if (trainingSelect) {
                    trainingSelect.innerHTML = '';
                    data.extractions.forEach(extraction => {
                        const option = document.createElement('option');
                        option.value = extraction.filename;
                        
                        // Format date for display
                        const extractionDate = new Date(extraction.created);
                        const formattedDate = extractionDate.toLocaleDateString();
                        
                        option.textContent = `${extraction.collection} - ${extraction.start_date} to ${extraction.end_date} (${formattedDate})`;
                        trainingSelect.appendChild(option);
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error loading extractions for training:', error);
        if (trainingSelect) trainingSelect.innerHTML = `<option value="">Error: ${error.message}</option>`;
    }
}

// Load models for the current project
async function loadModels() {
    const modelsList = document.getElementById('models-list');
    modelsList.innerHTML = '<div class="loading">Loading models...</div>';
    
    try {
        const response = await fetch(`${API_URL}/list_models?project_id=${currentProjectId}`);
        const data = await response.json();
        
        if (data.success) {
            if (data.models.length === 0) {
                modelsList.innerHTML = '<div class="loading">No models found for this project.</div>';
                document.getElementById('models-results').classList.add('hidden');
            } else {
                modelsList.innerHTML = '';
                
                data.models.forEach(model => {
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
                document.getElementById('models-results').classList.remove('hidden');
            }
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        console.error('Error loading models:', error);
        modelsList.innerHTML = `<div class="loading">Error loading models: ${error.message}</div>`;
    }
}

// Load models for deployment
async function loadDeploymentModels() {
    const modelSelect = document.getElementById('deployment-model');
    const noModelsMessage = document.getElementById('no-trained-models');
    const deploymentControls = document.getElementById('deployment-controls');
    
    try {
        const response = await fetch(`${API_URL}/list_models?project_id=${currentProjectId}`);
        const data = await response.json();
        
        if (data.success) {
            if (data.models.length === 0) {
                noModelsMessage.classList.remove('hidden');
                deploymentControls.classList.add('hidden');
            } else {
                noModelsMessage.classList.add('hidden');
                deploymentControls.classList.remove('hidden');
                
                // Clear existing options
                modelSelect.innerHTML = '<option value="">Select a model...</option>';
                
                // Add model options
                data.models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.name;
                    option.textContent = `${model.name} (${(model.metrics.acc * 100).toFixed(1)}% accuracy)`;
                    modelSelect.appendChild(option);
                });
                
                // Set the latest model as default
                if (data.models.length > 0) {
                    modelSelect.value = data.models[0].name;
                }
            }
        } else {
            throw new Error(data.message);
        }
    } catch (error) {
        console.error('Error loading models:', error);
        modelSelect.innerHTML = '<option value="">Error loading models</option>';
    }
}

// Deploy model button
document.getElementById('deploy-btn').addEventListener('click', startDeployment);

// Start deployment function
function startDeployment() {
    if (!currentProjectId) {
        showProjectModal();
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
        alert('Please select a model to deploy');
        return;
    }
    
    if (!startDate || !endDate) {
        alert('Please select start and end dates');
        return;
    }
    
    // Clear any existing predictions from the map
    if (map.getLayer('deployment-predictions-line')) {
        map.removeLayer('deployment-predictions-line');
    }
    if (map.getSource('deployment-predictions')) {
        map.removeSource('deployment-predictions');
    }
    if (map.getLayer('deployment-bbox')) {
        map.removeLayer('deployment-bbox');
    }
    if (map.getSource('deployment-bbox')) {
        map.removeSource('deployment-bbox');
    }
    
    // Reset progress bar and log message
    const progressBar = document.getElementById('deployment-progress');
    const progressText = document.getElementById('deployment-progress-text');
    lastLogMessage = ''; // Reset the last log message
    
    if (progressBar && progressText) {
        progressBar.style.width = '0%';
        progressText.textContent = 'Starting deployment...';
    }
    
    // Show status
    document.getElementById('deployment-status').classList.remove('hidden');
    document.getElementById('deploy-btn').disabled = true;
    
    // Get the current map bounds
    const bounds = map.getBounds();
    
    // Send deployment request
    fetch(`${API_URL}/deploy_model`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            project_id: currentProjectId,
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
        })
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            throw new Error(data.message || 'Failed to start deployment');
        }
    })
    .catch(error => {
        document.getElementById('deployment-progress-text').textContent = `Error: ${error.message}`;
        document.getElementById('deploy-btn').disabled = false;
        showNotification(`Deployment error: ${error.message}`, 'error');
    });
}

// Store the most recent log message
let lastLogMessage = '';

// Function to update deployment progress
function updateDeploymentProgress(data) {
    const progressBar = document.getElementById('deployment-progress');
    const progressText = document.getElementById('deployment-progress-text');
    const progressContainer = document.getElementById('deployment-status');
    
    if (progressBar && progressText) {
        const percent = Math.round(data.progress * 100);
        progressBar.style.width = `${percent}%`;
        
        // Update the progress bar color based on progress
        if (percent < 25) {
            progressBar.style.backgroundColor = '#3498db'; // Blue
        } else if (percent < 75) {
            progressBar.style.backgroundColor = '#2ecc71'; // Green
        } else {
            progressBar.style.backgroundColor = '#27ae60'; // Darker green
        }
        
        // Create appropriate log message based on progress
        let logMessage;
        if (percent === 0) {
            logMessage = `Starting deployment with region bounds`;
        } else if (percent === 10) {
            logMessage = `Initialized Earth Engine and preparing satellite collection`;
        } else if (percent === 25) {
            logMessage = `Processing satellite imagery for the selected date range`;
        } else if (percent === 50) {
            logMessage = `Running model predictions on image tiles`;
        } else if (percent === 75) {
            logMessage = `Post-processing predictions and generating GeoJSON`;
        } else if (percent === 100) {
            logMessage = `Deployment complete! Results ready to display`;
        } else if (data.status && data.status.includes("tile")) {
            logMessage = `${data.status}`;
        } else {
            logMessage = data.status || `Processing (${percent}%)`;
        }
        
        // If we have a recent log message from the backend, display it instead
        if (lastLogMessage) {
            progressText.textContent = lastLogMessage;
        } else {
            // Otherwise use the progress-based message
            progressText.textContent = logMessage;
        }
        
        // Handle incremental predictions if available
        if (data.incremental_predictions && data.incremental_predictions.features && data.incremental_predictions.features.length > 0) {
            // Display the incremental predictions on the map
            displayIncrementalPredictions(data.incremental_predictions, data.bounding_box);
        }
    }
}

// Function to display incremental predictions on the map
function displayIncrementalPredictions(predictions, boundingBox) {
    // Initialize the predictions source if it doesn't exist yet
    if (!map.getSource('deployment-predictions')) {
        // Add the bounding box if provided and not already added
        if (boundingBox && !map.getSource('deployment-bbox')) {
            map.addSource('deployment-bbox', {
                type: 'geojson',
                data: boundingBox
            });
            
            map.addLayer({
                id: 'deployment-bbox',
                type: 'line',
                source: 'deployment-bbox',
                paint: {
                    'line-color': '#27ae60',
                    'line-width': 2,
                    'line-dasharray': [2, 1]
                }
            });
        }
        
        // Add an empty predictions source
        map.addSource('deployment-predictions', {
            type: 'geojson',
            data: {
                type: 'FeatureCollection',
                features: []
            }
        });
        
        // Add the predictions line layer
        map.addLayer({
            id: 'deployment-predictions-line',
            type: 'line',
            source: 'deployment-predictions',
            paint: {
                'line-color': '#FF6F00',
                'line-width': 2,
                'line-opacity': [
                    'get', 'confidence'  // Use the confidence property directly for opacity
                ]
            }
        });
    }
    
    // Get the current predictions data
    const source = map.getSource('deployment-predictions');
    const currentData = source._data || { type: 'FeatureCollection', features: [] };
    
    // Add the new predictions to the existing ones
    const updatedFeatures = [...currentData.features, ...predictions.features];
    
    // Update the source data
    source.setData({
        type: 'FeatureCollection',
        features: updatedFeatures
    });
    
    // If this is the first batch of predictions, fit the map to them
    if (currentData.features.length === 0 && predictions.features.length > 0) {
        try {
            const bounds = new mapboxgl.LngLatBounds();
            
            // Add the bounding box to the bounds
            if (boundingBox && boundingBox.geometry && boundingBox.geometry.coordinates) {
                boundingBox.geometry.coordinates[0].forEach(coord => {
                    bounds.extend(coord);
                });
            }
            
            if (!bounds.isEmpty()) {
                map.fitBounds(bounds, {
                    padding: 50,
                    maxZoom: 16
                });
            }
        } catch (error) {
            console.error('Error fitting bounds to predictions', error);
        }
    }
}

// Function to handle deployment completion
function handleDeploymentComplete(data) {
    const progressBar = document.getElementById('deployment-progress');
    const progressText = document.getElementById('deployment-progress-text');
    const progressContainer = document.getElementById('deployment-status');
    
    // Reset the last log message
    lastLogMessage = '';
    
    // Re-enable the deploy button
    document.getElementById('deploy-btn').disabled = false;
    
    // Hide the deployment status container
    if (progressContainer) {
        progressContainer.classList.add('hidden');
    }
    
    // Display the predictions on the map if they haven't been displayed incrementally
    if (data && data.predictions && (!map.getSource('deployment-predictions') || map.getSource('deployment-predictions')._data.features.length === 0)) {
        displayDeploymentPredictions(data.predictions, data.bounding_box);
    }
    
    // Show notification about completion
    if (data && data.predictions) {
        showNotification(`Deployment complete: ${data.predictions.features ? data.predictions.features.length : 0} predictions displayed`, 'success');
    } else {
        console.error('No predictions data received from server');
        showNotification('No prediction data received from server', 'error');
    }
}

// Display deployment predictions on the map
function displayDeploymentPredictions(predictions, boundingBox) {
    if (!predictions || typeof predictions !== 'object') {
        console.error('Invalid predictions data received', predictions);
        return;
    }
    
    // Remove any existing prediction layers and sources
    if (map.getLayer('deployment-predictions-line')) {
        map.removeLayer('deployment-predictions-line');
    }
    if (map.getSource('deployment-predictions')) {
        map.removeSource('deployment-predictions');
    }
    
    // Remove any existing bounding box
    if (map.getLayer('deployment-bbox')) {
        map.removeLayer('deployment-bbox');
    }
    if (map.getSource('deployment-bbox')) {
        map.removeSource('deployment-bbox');
    }
    
    // Add predictions to the map if there are any features
    if (predictions.features && predictions.features.length > 0) {
        // Add the predictions as a source
        map.addSource('deployment-predictions', {
            type: 'geojson',
            data: predictions
        });
        
        // Add an outline layer to display the bounding boxes with opacity based on confidence
        map.addLayer({
            id: 'deployment-predictions-line',
            type: 'line',
            source: 'deployment-predictions',
            paint: {
                'line-color': '#FF6F00',
                'line-width': 2,
                'line-opacity': [
                    'get', 'confidence'  // Use the confidence property directly for opacity
                ]
            }
        });
        
        // If there's a bounding box, add it to the map
        if (boundingBox && boundingBox.geometry) {
            map.addSource('deployment-bbox', {
                type: 'geojson',
                data: boundingBox
            });
            
            map.addLayer({
                id: 'deployment-bbox',
                type: 'line',
                source: 'deployment-bbox',
                paint: {
                    'line-color': '#27ae60',
                    'line-width': 2,
                    'line-dasharray': [2, 1]
                }
            });
        }
        
        // Fit the map to the predictions
        try {
            const bounds = new mapboxgl.LngLatBounds();
            predictions.features.forEach(feature => {
                if (feature.geometry && feature.geometry.coordinates) {
                    // Handle different geometry types
                    if (feature.geometry.type === 'Polygon') {
                        // For polygons, extend bounds with each coordinate
                        feature.geometry.coordinates[0].forEach(coord => {
                            bounds.extend(coord);
                        });
                    } else if (feature.geometry.type === 'Point') {
                        // For points, extend with the single coordinate
                        bounds.extend(feature.geometry.coordinates);
                    }
                }
            });
            
            if (!bounds.isEmpty()) {
                map.fitBounds(bounds, {
                    padding: 50,
                    maxZoom: 16
                });
            }
        } catch (error) {
            console.error('Error fitting bounds to predictions', error);
        }
    }
}

// Update threshold value display for imagery panel
document.getElementById('imagery-clear-threshold').addEventListener('input', (e) => {
    document.getElementById('imagery-threshold-value').textContent = e.target.value;
});

// Handle map imagery form submission
document.getElementById('map-imagery-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const collection = document.getElementById('imagery-collection').value;
    const startDate = document.getElementById('imagery-start-date').value;
    const endDate = document.getElementById('imagery-end-date').value;
    const clearThreshold = document.getElementById('imagery-clear-threshold').value;
    
    // Get the current map bounds
    const bounds = map.getBounds();
    
    const statusElement = document.getElementById('imagery-status');
    statusElement.style.display = 'flex';
    
    try {
        // Clean up any existing overlay
        cleanupSentinelOverlay();
        
        // Fetch map imagery from the backend
        const response = await fetch(`${API_URL}/get_map_imagery?west=${bounds.getWest()}&south=${bounds.getSouth()}&east=${bounds.getEast()}&north=${bounds.getNorth()}&start_date=${startDate}&end_date=${endDate}&collection=${collection}&clear_threshold=${clearThreshold}`);
        
        if (!response.ok) {
            throw new Error('Failed to load map imagery');
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.message || 'Failed to load map imagery');
        }
        
        console.log('Data from server:', data);
        console.log('Using tile URL:', data.tile_url);
        
        // Define the image bounds 
        const imageBounds = [
            [data.bounds.west, data.bounds.south], // Southwest coordinates
            [data.bounds.east, data.bounds.north]  // Northeast coordinates
        ];
        
        // Save the current points data before changing style
        const pointsData = points.slice(); // Create a copy of the points array
        
        // Check if we have prediction layers and save their data
        let predictionData = null;
        let deploymentPredictionData = null;
        let hasPredictions = false;
        let hasDeploymentPredictions = false;
        
        try {
            // Check for regular predictions
            if (map.getSource('predictions')) {
                predictionData = map.getSource('predictions')._data;
                hasPredictions = true;
            }
            
            // Check for deployment predictions
            if (map.getSource('deployment-predictions')) {
                deploymentPredictionData = map.getSource('deployment-predictions')._data;
                hasDeploymentPredictions = true;
            }
        } catch (e) {
            console.warn('Error checking prediction layers:', e);
        }
        
        // Change to a simpler style to better show the imagery
        // Then set up listener to restore all content when style loads
        map.once('style.load', () => {
            // Re-add the points source and layers
            map.addSource('points', {
                type: 'geojson',
                data: pointsToGeoJSON(pointsData) // Convert saved points to GeoJSON
            });
            
            // Add the positive points layer
            map.addLayer({
                id: 'positive-points',
                type: 'circle',
                source: 'points',
                filter: ['==', 'class', 'positive'],
                paint: {
                    'circle-radius': 8,
                    'circle-color': '#4CAF50',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#FFFFFF'
                }
            });
            
            // Add the negative points layer
            map.addLayer({
                id: 'negative-points',
                type: 'circle',
                source: 'points',
                filter: ['==', 'class', 'negative'],
                paint: {
                    'circle-radius': 8,
                    'circle-color': '#F44336',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#FFFFFF'
                }
            });
            
            // Update the points source reference
            pointsSource = map.getSource('points');
            
            // Add the raster tiles as a source
            map.addSource('sentinel-imagery', {
                type: 'raster',
                tiles: [data.tile_url],
                tileSize: 256,
                attribution: `Sentinel ${collection === 'S2' ? '2' : '1'} Imagery (${startDate} to ${endDate})`
            });
            
            // Add the raster layer (make sure it's below the points)
            map.addLayer({
                id: 'sentinel-imagery',
                type: 'raster',
                source: 'sentinel-imagery',
                paint: {
                    'raster-opacity': 1.0
                }
            }, 'positive-points'); // Add below the points layers
            
            // Restore prediction layers if they existed
            if (hasPredictions) {
                // Re-add the predictions source
                map.addSource('predictions', {
                    type: 'geojson',
                    data: predictionData
                });
                
                // Re-add the predictions layer - keep it above the raster layer
                map.addLayer({
                    id: 'predictions',
                    type: 'fill',
                    source: 'predictions',
                    paint: {
                        'fill-color': '#4a90e2',
                        'fill-opacity': 0.4,
                        'fill-outline-color': '#2c54b2'
                    }
                });
            }
            
            // Restore deployment prediction layers if they existed
            if (hasDeploymentPredictions) {
                // Re-add the deployment predictions source
                map.addSource('deployment-predictions', {
                    type: 'geojson',
                    data: deploymentPredictionData
                });
                
                // Re-add the deployment predictions line layer with opacity based on confidence
                map.addLayer({
                    id: 'deployment-predictions-line',
                    type: 'line',
                    source: 'deployment-predictions',
                    paint: {
                        'line-color': '#FF6F00',
                        'line-width': 2,
                        'line-opacity': [
                            'get', 'confidence'  // Use the confidence property directly for opacity
                        ]
                    }
                });
            }
            
            console.log('Added sentinel tile layer');
            
            // Add error listener for tile loading issues
            map.on('error', function(e) {
                console.error('Mapbox error:', e);
            });
        });
        
        // Change to a light style to better show the imagery
        map.setStyle('mapbox://styles/mapbox/light-v10');
        
        // Zoom to the imagery bounds
        map.fitBounds(imageBounds, { padding: 50 });
        
        statusElement.style.display = 'none';
        showNotification('Sentinel imagery loaded successfully', 'success');
    } catch (error) {
        console.error('Error loading map imagery:', error);
        statusElement.style.display = 'none';
        showNotification(`Error loading map imagery: ${error.message}`, 'error');
    }
});

// Clean up the sentinel overlay
function cleanupSentinelOverlay() {
    try {
        // Only clean up the tile layer approach now
        if (map.getLayer('sentinel-imagery')) {
            map.removeLayer('sentinel-imagery');
            console.log('Removed sentinel-imagery layer');
        }
        
        if (map.getSource('sentinel-imagery')) {
            map.removeSource('sentinel-imagery');
            console.log('Removed sentinel-imagery source');
        }
    } catch (error) {
        console.error('Error cleaning up imagery:', error);
    }
}

// Remove imagery button
document.getElementById('remove-imagery-btn').addEventListener('click', () => {
    try {
        // Clean up the overlay approach
        cleanupSentinelOverlay();
        
        // For the tile approach, we need to preserve points and predictions when switching styles
        const currentStyle = map.getStyle().name;
        
        // If we're using a non-satellite style (e.g., light style for tiles)
        if (currentStyle !== 'Mapbox Satellite') {
            // Save the current points data
            const pointsData = points.slice();
            
            // Check if we have prediction layers and save their data
            let predictionData = null;
            let deploymentPredictionData = null;
            let hasPredictions = false;
            let hasDeploymentPredictions = false;
            
            try {
                // Check for regular predictions
                if (map.getSource('predictions')) {
                    predictionData = map.getSource('predictions')._data;
                    hasPredictions = true;
                }
                
                // Check for deployment predictions
                if (map.getSource('deployment-predictions')) {
                    deploymentPredictionData = map.getSource('deployment-predictions')._data;
                    hasDeploymentPredictions = true;
                }
            } catch (e) {
                console.warn('Error checking prediction layers:', e);
            }
            
            // Set up a listener to restore points and predictions after style change
            map.once('style.load', () => {
                // Re-add the points source and layers
                map.addSource('points', {
                    type: 'geojson',
                    data: pointsToGeoJSON(pointsData)
                });
                
                // Add the positive points layer
                map.addLayer({
                    id: 'positive-points',
                    type: 'circle',
                    source: 'points',
                    filter: ['==', 'class', 'positive'],
                    paint: {
                        'circle-radius': 8,
                        'circle-color': '#4CAF50',
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#FFFFFF'
                    }
                });
                
                // Add the negative points layer
                map.addLayer({
                    id: 'negative-points',
                    type: 'circle',
                    source: 'points',
                    filter: ['==', 'class', 'negative'],
                    paint: {
                        'circle-radius': 8,
                        'circle-color': '#F44336',
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#FFFFFF'
                    }
                });
                
                // Update the points source reference
                pointsSource = map.getSource('points');
                
                // Restore prediction layers if they existed
                if (hasPredictions) {
                    // Re-add the predictions source
                    map.addSource('predictions', {
                        type: 'geojson',
                        data: predictionData
                    });
                    
                    // Re-add the predictions layer
                    map.addLayer({
                        id: 'predictions',
                        type: 'fill',
                        source: 'predictions',
                        paint: {
                            'fill-color': '#4a90e2',
                            'fill-opacity': 0.4,
                            'fill-outline-color': '#2c54b2'
                        }
                    });
                }
                
                // Restore deployment prediction layers if they existed
                if (hasDeploymentPredictions) {
                    // Re-add the deployment predictions source
                    map.addSource('deployment-predictions', {
                        type: 'geojson',
                        data: deploymentPredictionData
                    });
                    
                    // Re-add the deployment predictions line layer with opacity based on confidence
                    map.addLayer({
                        id: 'deployment-predictions-line',
                        type: 'line',
                        source: 'deployment-predictions',
                        paint: {
                            'line-color': '#FF6F00',
                            'line-width': 2,
                            'line-opacity': [
                                'get', 'confidence'  // Use the confidence property directly for opacity
                            ]
                        }
                    });
                }
            });
            
            // Change back to satellite style
            map.setStyle('mapbox://styles/mapbox/satellite-v9');
        }
        
        showNotification('Satellite imagery removed', 'info');
    } catch (error) {
        console.error('Error removing imagery:', error);
        showNotification('Error removing satellite imagery', 'error');
    }
});

// Function to show notification
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            notification.remove();
        }, 300);
    }, 3000);
}

// Initialize the panel manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // First do initial cleanup - hide all panels
    document.querySelectorAll('.panel, .modal').forEach(panel => {
        panel.classList.remove('active');
        // Remove explicit style manipulations
        panel.style.removeProperty('visibility');
        panel.style.removeProperty('opacity');
        panel.style.removeProperty('transform');
    });
    
    // Then initialize the panel manager
    PanelManager.init();
});

// Socket event listeners for deployment
socket.on('deployment_progress', updateDeploymentProgress);
socket.on('deployment_complete', handleDeploymentComplete);
socket.on('deployment_log', (data) => {
    // Strip log prefixes like "INFO:deploy:" or "INFO:__main__:" from the message
    let cleanMessage = data.message;
    
    // Match common log prefixes like INFO:module_name:
    const logPrefixRegex = /^(INFO|DEBUG|WARNING|ERROR):[^:]*:\s*/;
    if (logPrefixRegex.test(cleanMessage)) {
        cleanMessage = cleanMessage.replace(logPrefixRegex, '');
    }
    
    // Store the cleaned log message
    lastLogMessage = cleanMessage;
    
    // Update the progress text if it exists
    const progressText = document.getElementById('deployment-progress-text');
    if (progressText) {
        progressText.textContent = cleanMessage;
    }
});
socket.on('deployment_error', (data) => {
    const progressText = document.getElementById('deployment-progress-text');
    const progressBar = document.getElementById('deployment-progress');
    const progressContainer = document.getElementById('deployment-status');
    
    if (progressText) {
        progressText.textContent = `Error: ${data.error}`;
        
        if (progressBar) {
            progressBar.style.backgroundColor = '#e74c3c'; // Red for error
            progressBar.classList.add('complete'); // Stop animation
        }
        
        if (progressContainer) {
            progressContainer.classList.add('complete');
        }
    }
    
    document.getElementById('deploy-btn').disabled = false;
    showNotification(`Deployment error: ${data.error}`, 'error');
});

// Add a style element to the head to update the progress-text styling
document.addEventListener('DOMContentLoaded', function() {
    // Add custom styles for the progress text to handle log messages better
    const style = document.createElement('style');
    style.textContent = `
        .progress-text {
            margin-top: 8px;
            font-size: 14px;
            color: #333;
            white-space: normal;
            word-wrap: break-word;
            line-height: 1.4;
            max-height: 80px;
            overflow-y: auto;
        }
    `;
    document.head.appendChild(style);
});

// Training panel button
document.getElementById('train-model-btn').addEventListener('click', () => {
    console.log("Opening training panel");
    
    // First, open the panel
    PanelManager.openPanel('training-panel', 'train-model-btn');
    
    // Now make sure the panel is completely rendered before trying to access elements
    setTimeout(() => {
        // Get elements with safety checks
        const noTrainingExtractions = document.getElementById('no-training-extractions');
        const trainingControls = document.getElementById('training-controls');
        
        // Make sure error messages are hidden initially
        if (noTrainingExtractions) {
            noTrainingExtractions.classList.add('hidden');
        }
        
        // Make sure controls are visible
        if (trainingControls) {
            trainingControls.classList.remove('hidden');
        }
        
        // Call loadTrainingExtractions to populate the panel
        loadTrainingExtractions();
        
        // Check if we have models to display
        loadModels();
    }, 100); // Small delay to ensure the DOM is updated
});