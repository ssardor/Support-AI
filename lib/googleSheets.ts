import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

// Initialize auth
let creds: any;

if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
  creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
} else {
  const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'service-account.json');
  if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    creds = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'));
  } else {
    throw new Error("Credentials missing: Set GOOGLE_SERVICE_ACCOUNT_JSON or create service-account.json");
  }
}

const serviceAccountAuth = new JWT({
  email: creds.client_email,
  key: creds.private_key,
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],
});

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID!, serviceAccountAuth);

async function ensureHeaders(sheet: any) {
  await sheet.loadHeaderRow();
  const headers = sheet.headerValues;
  if (!headers.includes('Contact_Info')) {
    await sheet.setHeaderRow([...headers, 'Contact_Info']);
  }
}

export async function getAvailability(date: string, subject: string) {
  await doc.loadInfo(); // loads document properties and worksheets
  const sheet = doc.sheetsByTitle['schedule'];
  
  if (!sheet) {
    throw new Error("Sheet 'schedule' not found");
  }

  const rows = await sheet.getRows();
  
  // Filter rows based on date, subject and empty Student_Name
  // Assuming Date format in sheet matches the input date string or we need to normalize
  // For MVP, we assume exact string match or simple inclusion
  
  const availableSlots = rows.filter(row => {
    const rowDate = row.get('Date');
    const rowSubject = row.get('Subject');
    const studentName = row.get('Student_Name');
    
    // Simple check. In production, use proper date parsing.
    return rowDate === date && rowSubject === subject && (!studentName || studentName.trim() === '');
  });

  return availableSlots.map(row => ({
    rowId: row.rowNumber, // 1-based index usually, but google-spreadsheet might expose it differently. 
                         // Actually row.rowNumber is the 1-based index in the sheet.
    time: row.get('Time'),
    teacher: row.get('Teacher'),
    date: row.get('Date'),
    subject: row.get('Subject')
  }));
}

export async function bookSlot(rowId: number, studentName: string, contactInfo: string) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle['schedule'];
  
  if (!sheet) {
    throw new Error("Sheet 'schedule' not found");
  }

  await ensureHeaders(sheet);

  // google-spreadsheet rows are usually fetched. To update a specific row by ID (index), 
  // we might need to fetch it or use loadCells.
  // However, getRows returns an array of Row objects which we can save.
  // But here we are passing rowId from the previous call.
  
  // Since we have the rowId (rowIndex), we can fetch that specific row or all rows and find it.
  // Fetching all rows again to ensure we have the latest state (concurrency check).
  const rows = await sheet.getRows();
  
  // rowId in google-spreadsheet is usually 1-based index of the row in the sheet.
  // The array returned by getRows() does not include the header row.
  // So row 2 in Excel is index 0 in the array? No.
  // Let's assume rowId passed back is the rowIndex property from the row object.
  
  const rowToUpdate = rows.find(r => r.rowNumber === rowId);

  if (!rowToUpdate) {
    throw new Error(`Row with ID ${rowId} not found`);
  }

  const currentStudent = rowToUpdate.get('Student_Name');
  if (currentStudent && currentStudent.trim() !== '') {
    throw new Error("Aiyo, someone just took this slot. Pick another time?");
  }

  rowToUpdate.set('Student_Name', studentName);
  rowToUpdate.set('Contact_Info', contactInfo);
  await rowToUpdate.save();
  
  return { success: true, message: "Done lah! See you." };
}

export async function addSlot(date: string, time: string, subject: string, teacher: string) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle['schedule'];
  
  if (!sheet) {
    throw new Error("Sheet 'schedule' not found");
  }

  await ensureHeaders(sheet);

  await sheet.addRow({
    Date: date,
    Time: time,
    Subject: subject,
    Teacher: teacher,
    Student_Name: '',
    Contact_Info: ''
  });

  return { success: true, message: "Slot added successfully!" };
}

export async function createBatchSchedule(startDate: string, days: number, subject: string, teacher: string) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle['schedule'];
  
  if (!sheet) {
    throw new Error("Sheet 'schedule' not found");
  }

  await ensureHeaders(sheet);

  const start = new Date(startDate);
  const rowsToAdd = [];

  for (let i = 0; i < days; i++) {
    const currentDate = new Date(start);
    currentDate.setDate(start.getDate() + i);

    // Check for weekends (0 = Sun, 6 = Sat)
    // Using getUTCDay to avoid timezone issues since we treat input as pure date
    const dayOfWeek = currentDate.getUTCDay(); 
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    const dateStr = currentDate.toISOString().split('T')[0];

    // 10:00 to 18:00 (last slot at 17:00)
    for (let hour = 10; hour < 18; hour++) {
      rowsToAdd.push({
        Date: dateStr,
        Time: `${hour}:00`,
        Subject: subject,
        Teacher: teacher,
        Student_Name: '',
        Contact_Info: ''
      });
    }
  }

  if (rowsToAdd.length > 0) {
    await sheet.addRows(rowsToAdd);
  }
  
  return { success: true, message: `Added ${rowsToAdd.length} slots starting from ${startDate} (Mon-Fri only, 10am-6pm).` };
}

export async function getKnowledgeBase() {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle['knowledge'];
  
  if (!sheet) {
    throw new Error("Sheet 'knowledge' not found");
  }

  const rows = await sheet.getRows();
  return rows.map(row => ({
    question: row.get('Question'),
    answer: row.get('Answer')
  }));
}
