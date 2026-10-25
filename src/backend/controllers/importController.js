const ExcelJS = require('exceljs');
const { badRequest } = require('../middleware/errors');

/**
 * POST /import/parse-excel
 * Accepts a multipart upload (field: "file"), parses with exceljs,
 * returns { sheets: string[], rows: object[], columns: string[] }
 */
async function parseExcel(req, res) {
    if (!req.file) throw badRequest('No file uploaded');

    const sheetName = req.body.sheet || null;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);

    const sheetNames = workbook.worksheets.map(ws => ws.name);

    const ws = sheetName
        ? workbook.getWorksheet(sheetName)
        : workbook.worksheets[0];

    if (!ws) throw badRequest('Sheet not found');

    // First row = headers
    const headers = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, colNum) => {
        headers[colNum - 1] = cell.text || `col${colNum}`;
    });

    const rows = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
        if (rowNum === 1) return; // skip header
        const obj = {};
        row.eachCell({ includeEmpty: true }, (cell, colNum) => {
            const h = headers[colNum - 1];
            // A "__proto__" header would replace the row object's prototype
            if (!h || h === '__proto__') return;
            // Preserve numeric and boolean values from Excel
            if (cell.type === ExcelJS.ValueType.Number || cell.type === ExcelJS.ValueType.Boolean) {
                obj[h] = cell.value;
            } else if (cell.type === ExcelJS.ValueType.Formula) {
                const v = cell.result;
                obj[h] = v !== undefined ? v : cell.text;
            } else {
                obj[h] = cell.text;
            }
        });
        if (Object.keys(obj).length > 0) rows.push(obj);
    });

    res.json({ sheets: sheetNames, rows, columns: headers });
}

module.exports = { parseExcel };
