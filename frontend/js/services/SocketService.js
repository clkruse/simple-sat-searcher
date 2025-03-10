// js/services/SocketService.js
import { EventEmitter } from '../utils/EventEmitter.js';
import { config } from '../config.js';

class SocketService extends EventEmitter {
  constructor() {
    super();
    this.apiUrl = config.API_URL;
    this.socket = null;
    this.connected = false;
    
    // Connect to Socket.IO server
    this.connect();
  }
  
  connect() {
    try {
      this.socket = io(this.apiUrl);
      
      // Set up base event handlers
      this.socket.on('connect', () => {
        console.log('Socket.IO connected with ID:', this.socket.id);
        this.connected = true;
        this.emit('connected', this.socket.id);
      });
      
      this.socket.on('disconnect', (reason) => {
        console.warn('Socket.IO disconnected:', reason);
        this.connected = false;
        this.emit('disconnected', reason);
      });
      
      this.socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
        this.connected = false;
        this.emit('error', error);
      });
      
      // Set up application-specific event handlers
      this.setupEventHandlers();
      
    } catch (error) {
      console.error('Error initializing socket connection:', error);
      this.connected = false;
    }
  }
  
  setupEventHandlers() {
    // EXTRACTION EVENTS
    this.socket.on('extraction_progress', (data) => {
      this.emit('extraction_progress', data);
    });
    
    this.socket.on('extraction_complete', (data) => {
      this.emit('extraction_complete', data);
    });
    
    this.socket.on('extraction_error', (data) => {
      this.emit('extraction_error', data);
    });
    
    // TRAINING EVENTS
    this.socket.on('training_progress', (data) => {
      this.emit('training_progress', data);
    });
    
    this.socket.on('training_complete', (data) => {
      this.emit('training_complete', data);
    });
    
    this.socket.on('training_error', (data) => {
      this.emit('training_error', data);
    });
    
    // DEPLOYMENT EVENTS
    this.socket.on('deployment_progress', (data) => {
      this.emit('deployment_progress', data);
    });
    
    this.socket.on('deployment_complete', (data) => {
      this.emit('deployment_complete', data);
    });
    
    this.socket.on('deployment_log', (data) => {
      this.emit('deployment_log', data);
    });
    
    this.socket.on('deployment_error', (data) => {
      this.emit('deployment_error', data);
    });
  }
  
  // Send a message through the socket
  send(event, data) {
    if (this.socket && this.connected) {
      this.socket.emit(event, data);
      return true;
    } else {
      console.warn('Socket not connected, cannot send message:', event);
      return false;
    }
  }
  
  // Disconnect the socket
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }
}

// Create a singleton instance
const socketService = new SocketService();

export { socketService };