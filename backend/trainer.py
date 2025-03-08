import os
import logging
import datetime
import json
import numpy as np
import xarray as xr
from tensorflow import keras
from tensorflow.keras import layers
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report
import pickle

logger = logging.getLogger(__name__)

class ModelTrainer:
    def __init__(self, project_id, project_dir):
        """Initialize the model trainer.
        
        Args:
            project_id (str): The project ID
            project_dir (str): Path to the project directory
        """
        self.project_id = project_id
        self.project_dir = project_dir
        self.models_dir = os.path.join(project_dir, "models")
        os.makedirs(self.models_dir, exist_ok=True)
        
    def load_data(self, extraction_files):
        """Load and preprocess data from extraction files.
        
        Args:
            extraction_files (list): List of extraction file names
            
        Returns:
            tuple: (X, y) where X is the input data and y is the labels
        """
        all_chips = []
        all_labels = []
        
        for file in extraction_files:
            file_path = os.path.join(self.project_dir, "extracted_data", file)
            if not os.path.exists(file_path):
                raise FileNotFoundError(f"Extraction file {file} not found")
            
            # Load the dataset
            ds = xr.open_dataset(file_path)
            chips = ds.chips.values
            labels = ds.label.values
            
            # Convert string labels to numeric
            numeric_labels = np.array([1 if label == 'positive' else 0 for label in labels], dtype=np.float32)
            
            all_chips.append(chips)
            all_labels.append(numeric_labels)
            
            ds.close()
        
        # Combine all data
        X = np.concatenate(all_chips)
        y = np.concatenate(all_labels)
        
        # Normalize the data
        X = np.clip(X.astype("float32") / 10000, 0, 1)
        
        return X, y
    
    def create_model(self, input_shape):
        """Create the model architecture.
        
        Args:
            input_shape (tuple): Shape of input data (height, width, channels)
            
        Returns:
            keras.Model: Compiled model
        """
        model = keras.Sequential([
            keras.Input(shape=input_shape),
            layers.Conv2D(32, kernel_size=(3), padding='same', activation="relu"),
            layers.BatchNormalization(),
            layers.Conv2D(32, kernel_size=(3), padding='same', activation="relu"),
            layers.BatchNormalization(),
            layers.MaxPooling2D(pool_size=(2)),
            layers.Conv2D(64, kernel_size=(3), padding='same', activation="relu"),
            layers.BatchNormalization(),
            layers.Conv2D(64, kernel_size=(3), padding='same', activation="relu"),
            layers.BatchNormalization(),
            layers.MaxPooling2D(pool_size=(2)),
            layers.Conv2D(128, kernel_size=(3), padding='same', activation="relu"),
            layers.BatchNormalization(),
            layers.Conv2D(128, kernel_size=(3), padding='same', activation="relu"),
            layers.BatchNormalization(),
            layers.MaxPooling2D(pool_size=(2)),
            layers.Flatten(),
            layers.Dense(256, activation="relu"),
            layers.Dropout(0.5),
            layers.Dense(128, activation="relu"),
            layers.Dropout(0.3),
            layers.Dense(1, activation='sigmoid')
        ])
        
        # Compile the model
        model.compile(
            optimizer=keras.optimizers.Adam(1e-4),
            loss=keras.losses.BinaryCrossentropy(from_logits=False),
            metrics=[keras.metrics.BinaryAccuracy(name="acc")]
        )
        
        return model
    
    def train(self, model_name, extraction_files, batch_size=32, epochs=160, 
              test_split=0.3, augmentation=True, progress_callback=None):
        """Train the model.
        
        Args:
            model_name (str): Name for the trained model
            extraction_files (list): List of extraction file names
            batch_size (int): Batch size for training
            epochs (int): Number of training epochs
            test_split (float): Fraction of data to use for testing
            augmentation (bool): Whether to use data augmentation
            progress_callback (callable): Optional callback for training progress
            
        Returns:
            dict: Training results and metadata
        """
        try:
            # Load and preprocess data
            X, y = self.load_data(extraction_files)
            
            # Split into train and test sets
            X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_split, random_state=42)
            
            # Create data augmentation if requested
            if augmentation:
                datagen = ImageDataGenerator(
                    rotation_range=360,
                    width_shift_range=0.1,
                    height_shift_range=0.1,
                    shear_range=10,
                    zoom_range=0.1,
                    horizontal_flip=True,
                    vertical_flip=True,
                    fill_mode='reflect'
                )
            else:
                datagen = None
            
            # Create and compile model
            model = self.create_model(X_train.shape[1:])
            
            # Create training callback for progress updates
            class TrainingProgressCallback(keras.callbacks.Callback):
                def on_epoch_end(self, epoch, logs=None):
                    if progress_callback:
                        progress = (epoch + 1) / epochs * 100
                        progress_callback(progress, epoch + 1, epochs, logs)
            
            # Train the model
            if datagen:
                history = model.fit(
                    datagen.flow(X_train, y_train, batch_size=batch_size),
                    epochs=epochs,
                    validation_data=(X_test, y_test),
                    callbacks=[TrainingProgressCallback()],
                    verbose=1
                )
            else:
                history = model.fit(
                    X_train, y_train,
                    batch_size=batch_size,
                    epochs=epochs,
                    validation_data=(X_test, y_test),
                    callbacks=[TrainingProgressCallback()],
                    verbose=1
                )
            
            # Generate predictions and classification report
            y_pred = model.predict(X_test)
            y_pred_binary = (y_pred > 0.5).astype(int)
            report = classification_report(
                y_test.astype(int), 
                y_pred_binary,
                labels=[0, 1],
                target_names=['Negative', 'Positive']
            )
            
            # Save the model
            model_path = os.path.join(self.models_dir, f"{model_name}.h5")
            model.save(model_path)
            
            # Save training history
            history_path = os.path.join(self.models_dir, f"{model_name}_history.pkl")
            with open(history_path, 'wb') as f:
                pickle.dump(history.history, f)
            
            # Create metadata
            metadata = {
                "model_name": model_name,
                "created": datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
                "extraction_files": extraction_files,
                "input_shape": list(X_train.shape[1:]),  # Convert tuple to list for JSON serialization
                "batch_size": batch_size,
                "epochs": epochs,
                "test_split": test_split,
                "augmentation": augmentation,
                "final_metrics": {
                    "loss": float(history.history['loss'][-1]),
                    "acc": float(history.history['acc'][-1]),
                    "val_loss": float(history.history['val_loss'][-1]),
                    "val_acc": float(history.history['val_acc'][-1])
                },
                "classification_report": report
            }
            
            # Save metadata
            metadata_path = os.path.join(self.models_dir, f"{model_name}_metadata.json")
            with open(metadata_path, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            return {
                "success": True,
                "message": f"Model '{model_name}' trained successfully",
                "metadata": metadata
            }
            
        except Exception as e:
            logger.error(f"Error training model: {str(e)}")
            return {
                "success": False,
                "message": str(e)
            } 