import {
  GoogleSpreadsheet,
  GoogleSpreadsheetWorksheet,
  GoogleSpreadsheetRow,
} from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

// Initialize auth
interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

interface ScheduleRow {
  Date?: string;   
  Time?: string;
  Subject?: string;
  Teacher?: string;
  Student_Name?: string;
  Contact_Info?: string;
}

interface KnowledgeRow {
  Question?: string;
  Answer?: string;
}

export type KnowledgeBaseEntry = {
  question: string;
  answer: string;
};

export type SlotIdentifier = {
  date: string;
  time: string;
  subject: string;
  teacher: string;
};

export type AvailabilitySlot = SlotIdentifier & {
  rowNumber: number;
};

let creds: ServiceAccountCredentials;

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

async function loadSheet(title: string): Promise<GoogleSpreadsheetWorksheet> {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    throw new Error(`Sheet '${title}' not found`);
  }
  return sheet;
}

async function ensureHeaders(sheet: GoogleSpreadsheetWorksheet) {
  await sheet.loadHeaderRow();
  const headers = sheet.headerValues;
  if (!headers.includes('Contact_Info')) {
    await sheet.setHeaderRow([...headers, 'Contact_Info']);
  }
}

function formatContactInfo(contactInfo: string) {
  const trimmed = (contactInfo ?? '').trim();
  if (!trimmed) return '';
  const sanitized = trimmed.replace(/[\r\n]+/g, ' ').replace(/["']/g, '').trim();

  // Prefix with an apostrophe if the value might be treated as a formula (+ / = / -)
  if (/^[=+\-]/.test(sanitized)) {
    return `'${sanitized}`;
  }

  return sanitized;
}

function normalizeValue(value: string | undefined) {
  return (value ?? '').trim();
}

function normalizeSubject(value: string | undefined) {
  return normalizeValue(value).toLowerCase();
}

function matchesSlot(row: GoogleSpreadsheetRow<ScheduleRow>, slot: SlotIdentifier) {
  return (
    normalizeValue(row.get('Date')) === normalizeValue(slot.date) &&
    normalizeValue(row.get('Time')) === normalizeValue(slot.time) &&
    normalizeSubject(row.get('Subject')) === normalizeSubject(slot.subject) &&
    normalizeValue(row.get('Teacher')) === normalizeValue(slot.teacher)
  );
}

export async function getAvailability(date: string, subject: string) {
  const sheet = await loadSheet('schedule');
  const rows = await sheet.getRows<ScheduleRow>();

  const normalizedDate = normalizeValue(date);
  const normalizedSubject = normalizeSubject(subject);
  
  // Filter rows based on date, subject and empty Student_Name
  // Assuming Date format in sheet matches the input date string or we need to normalize
  // For MVP, we assume exact string match or simple inclusion
  
  const availableSlots = rows.filter(row => {
  const rowDate = normalizeValue(row.get('Date'));
    const rowSubject = normalizeSubject(row.get('Subject'));
    const studentName = row.get('Student_Name');
    
    // Simple check. In production, use proper date parsing.
    return (
      rowDate === normalizedDate &&
      rowSubject === normalizedSubject &&
      (!studentName || studentName.trim() === '')
    );
  });

  return availableSlots.map(row => ({
    rowNumber: row.rowNumber,
    time: normalizeValue(row.get('Time')),
    teacher: normalizeValue(row.get('Teacher')),
    date: normalizeValue(row.get('Date')),
    subject: normalizeValue(row.get('Subject')),
  }));
}

export async function bookSlot(slot: SlotIdentifier, studentName: string, contactInfo: string) {
  const sheet = await loadSheet('schedule');
  await ensureHeaders(sheet);

  // google-spreadsheet rows are usually fetched. To update a specific row by ID (index), 
  // we might need to fetch it or use loadCells.
  // However, getRows returns an array of Row objects which we can save.
  // But here we are passing rowId from the previous call.
  
  // Since we have the rowId (rowIndex), we can fetch that specific row or all rows and find it.
  // Fetching all rows again to ensure we have the latest state (concurrency check).
  const rows = await sheet.getRows<ScheduleRow>();
  
  // rowId in google-spreadsheet is usually 1-based index of the row in the sheet.
  // The array returned by getRows() does not include the header row.
  // So row 2 in Excel is index 0 in the array? No.
  // Let's assume rowId passed back is the rowIndex property from the row object.
  
  const rowToUpdate = rows.find(r => matchesSlot(r, slot));

  if (!rowToUpdate) {
    throw new Error(`Slot ${slot.date} ${slot.time} (${slot.teacher}) not found`);
  }

  const currentStudent = rowToUpdate.get('Student_Name');
  if (currentStudent && currentStudent.trim() !== '') {
    throw new Error("Aiyo, someone just took this slot. Pick another time?");
  }

  rowToUpdate.set('Student_Name', studentName);
  rowToUpdate.set('Contact_Info', formatContactInfo(contactInfo));
  await rowToUpdate.save();
  
  return { success: true, message: "Done lah! See you." };
}

export async function addSlot(date: string, time: string, subject: string, teacher: string) {
  const sheet = await loadSheet('schedule');
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
  const sheet = await loadSheet('schedule');
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

export async function getKnowledgeBase(): Promise<KnowledgeBaseEntry[]> {
  const sheet = await loadSheet('knowledge');
  const rows = await sheet.getRows<KnowledgeRow>();
  return rows.map((row) => ({
    question: row.get('Question') ?? '',
    answer: row.get('Answer') ?? '',
  }));
}
