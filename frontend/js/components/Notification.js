// js/components/Notification.js

class NotificationManager {
    constructor() {
      this.notifications = [];
      this.container = null;
      
      // Create container when the DOM is ready
      document.addEventListener('DOMContentLoaded', () => {
        this.createContainer();
      });
    }
    
    createContainer() {
      // Create container if it doesn't exist
      this.container = document.querySelector('.notifications-container');
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.className = 'notifications-container';
        this.container.style.position = 'fixed';
        this.container.style.bottom = '30px';
        this.container.style.right = '30px';
        this.container.style.display = 'flex';
        this.container.style.flexDirection = 'column';
        this.container.style.gap = '10px';
        this.container.style.zIndex = '9999';
        document.body.appendChild(this.container);
      }
      return this.container;
    }
    
    /**
     * Show a notification
     * @param {string} message - Notification message
     * @param {string} type - Notification type (info, success, warning, error)
     * @param {number} duration - How long to show the notification (ms)
     * @returns {HTMLElement} - The notification element
     */
    show(message, type = 'info', duration = 3000) {
      // Make sure container exists
      if (!this.container) {
        this.createContainer();
      }
      
      // Create notification element
      const notification = document.createElement('div');
      notification.className = `notification ${type}`;
      notification.textContent = message;
      
      // Add to DOM
      this.container.appendChild(notification);
      
      // Add to tracking array
      this.notifications.push(notification);
      
      // Show notification with animation
      setTimeout(() => {
        notification.classList.add('show');
      }, 10);
      
      // Hide notification after duration
      setTimeout(() => {
        notification.classList.remove('show');
        
        // Remove from DOM after animation completes
        setTimeout(() => {
          notification.remove();
          
          // Remove from tracking array
          const index = this.notifications.indexOf(notification);
          if (index > -1) {
            this.notifications.splice(index, 1);
          }
        }, 300);
      }, duration);
      
      return notification;
    }
    
    // Convenience methods for different notification types
    
    /**
     * Show an info notification
     * @param {string} message - Notification message
     * @param {number} duration - How long to show the notification (ms)
     * @returns {HTMLElement} - The notification element
     */
    info(message, duration = 3000) {
      return this.show(message, 'info', duration);
    }
    
    /**
     * Show a success notification
     * @param {string} message - Notification message
     * @param {number} duration - How long to show the notification (ms)
     * @returns {HTMLElement} - The notification element
     */
    success(message, duration = 3000) {
      return this.show(message, 'success', duration);
    }
    
    /**
     * Show a warning notification
     * @param {string} message - Notification message
     * @param {number} duration - How long to show the notification (ms)
     * @returns {HTMLElement} - The notification element
     */
    warning(message, duration = 3000) {
      return this.show(message, 'warning', duration);
    }
    
    /**
     * Show an error notification
     * @param {string} message - Notification message
     * @param {number} duration - How long to show the notification (ms)
     * @returns {HTMLElement} - The notification element
     */
    error(message, duration = 5000) {
      return this.show(message, 'error', duration);
    }
    
    /**
     * Clear all notifications
     */
    clearAll() {
      this.notifications.forEach(notification => {
        notification.classList.remove('show');
        setTimeout(() => {
          notification.remove();
        }, 300);
      });
      this.notifications = [];
    }
  }
  
  // Create and export a singleton instance
  const notificationManager = new NotificationManager();
  
  export { notificationManager };