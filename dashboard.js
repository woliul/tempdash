// Modules to control application life and create native browser window
const fs = require('fs');
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const initSqlJs = require('sql.js');

let dbModule; // Store the initialized SQL.js module

// --- Database Initialization (Only loads the SQL.js library, no data) ---
async function initializeDbModule() {
    if (dbModule) return;

    let WASM_PATH;
    // NOTE: This logic assumes you are running the dashboard app from a new Electron project structure
    if (process.env.NODE_ENV === 'development') {
        WASM_PATH = path.join(__dirname, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
    } else {
        WASM_PATH = path.join(process.resourcesPath, 'sql-wasm.wasm');
    }

    try {
        if (fs.existsSync(WASM_PATH)) {
            const wasmBinary = fs.readFileSync(WASM_PATH);
            dbModule = await initSqlJs({ wasmBinary: wasmBinary });
        } else {
            console.error(`WASM file not found at: ${WASM_PATH}. Attempting default load.`);
            dbModule = await initSqlJs();
        }
        console.log('SQL.js library initialized for dashboard.');
    } catch (e) {
        console.error('Failed to initialize sql.js:', e.message);
        throw e;
    }
}

/**
 * Reads a specified DB file, loads it into an in-memory SQL.js DB,
 * queries the entire log table, and returns the result.
 * @param {string} filePath - Path to the .db file.
 * @returns {Array<Object>} - Array of log entries.
 */
function readDbFileAndQuery(filePath) {
    if (!dbModule) throw new Error('SQL.js library not initialized.');

    let db;
    try {
        const filebuffer = fs.readFileSync(filePath);
        db = new dbModule.Database(filebuffer);
        console.log(`Loaded DB file from: ${filePath}`);

        const result = db.exec("SELECT sl, sensor_name, status, temperature, timestamp FROM temp_logs ORDER BY sl DESC");

        if (result.length === 0 || result[0].values.length === 0) {
            return [];
        }

        const columns = result[0].columns;
        const rows = result[0].values;
        
        // Map rows to objects for easy rendering and CSV generation
        const data = rows.map(row => {
            let entry = {};
            columns.forEach((col, index) => {
                entry[col] = row[index];
            });
            return entry;
        });

        return data;

    } catch (error) {
        console.error('Database query failed:', error);
        throw new Error(`Failed to process database file: ${error.message}`);
    } finally {
        if (db) db.close(); // Important: close the temporary database instance
    }
}


// --- IPC Handlers ---

// IPC Handler to open file dialog, read DB, and send logs back
ipcMain.handle('load-database-log', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow(), {
        title: 'Select Temperature Log Backup File',
        defaultPath: app.getPath('userData'), // Start in the user data directory
        buttonLabel: 'Load File',
        filters: [{ name: 'Database Files', extensions: ['db'] }]
    });

    if (canceled || filePaths.length === 0) {
        return { success: false, message: 'Canceled' };
    }

    const filePath = filePaths[0];

    try {
        const data = readDbFileAndQuery(filePath);
        return { 
            success: true, 
            filePath: filePath, 
            fileName: path.basename(filePath),
            data: data 
        };
    } catch (error) {
        return { success: false, message: error.message, filePath: filePath };
    }
});


// IPC Handler to export the loaded data to a CSV file
ipcMain.handle('export-to-csv', async (event, data) => {
    if (!data || data.length === 0) {
        return { success: false, message: 'No data provided for export.' };
    }

    const headers = Object.keys(data[0]);
    // Format: SL,Sensor Name,Status,Temperature (C),Time Stamp
    const csvHeaders = headers.map(h => {
        if (h === 'sensor_name') return 'Sensor Name';
        if (h === 'temperature') return 'Temperature (C)';
        if (h === 'timestamp') return 'Time Stamp';
        return h.toUpperCase();
    }).join(',');

    // Convert data rows to CSV lines
    const csvRows = data.map(row => headers.map(header => {
        // Handle null/special values and quote strings that contain commas
        let value = row[header];
        if (value === null || value === undefined) {
            value = '';
        } else if (typeof value === 'string' && value.includes(',')) {
            value = `"${value.replace(/"/g, '""')}"`; // Basic CSV escaping
        }
        return value;
    }).join(','));

    const csvContent = [csvHeaders, ...csvRows].join('\n');

    // Open Save Dialog
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), {
        title: 'Export Log Data to CSV',
        defaultPath: `log_data_export_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.csv`,
        buttonLabel: 'Save CSV',
        filters: [{ name: 'CSV File', extensions: ['csv'] }]
    });

    if (canceled || !filePath) {
        return { success: false, message: 'Canceled' };
    }

    try {
        fs.writeFileSync(filePath, csvContent);
        return { success: true, message: `Data successfully exported to CSV at: ${filePath}` };
    } catch (error) {
        console.error('CSV Write Failed:', error);
        return { success: false, message: `Failed to save CSV file: ${error.message}` };
    }
});

// IPC Handler to provide the default backup path hint
ipcMain.handle('get-initial-backup-path', () => {
    return path.join(app.getPath('userData'), 'backups');
});


// --- Electron Setup ---

function createDashboardWindow() {
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'dashboard-preload.js'),
            contextIsolation: true
        },
        icon: path.join(__dirname, '/assets/chart.png')
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(async () => {
    await initializeDbModule();
    createDashboardWindow();

    app.on('activate', function() {
        if (BrowserWindow.getAllWindows().length === 0) createDashboardWindow();
    });
});

app.on('window-all-closed', function() {
    if (process.platform !== 'darwin') app.quit();
});
