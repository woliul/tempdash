const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Allows the renderer to open the file dialog, load the DB, and get the data back
    loadDatabaseLog: () => ipcRenderer.invoke('load-database-log'),
    
    // Allows the renderer to send the loaded log data to the main process for CSV generation and file saving
    exportToCSV: (data) => ipcRenderer.invoke('export-to-csv', data),
    
    // Provides the default backup directory path for UI hint
    getInitialBackupPath: () => ipcRenderer.invoke('get-initial-backup-path'),
});
