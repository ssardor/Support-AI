import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

export const dynamic = 'force-dynamic';

export async function GET() {
  const results: any = {};

  // 1. Test Google Sheets
  try {
    if (!process.env.GOOGLE_SHEET_ID) {
      throw new Error("Missing GOOGLE_SHEET_ID env var");
    }

    let creds;
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } else {
      const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'service-account.json');
      if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
          throw new Error("service-account.json not found");
      }
      creds = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'));
    }

    const serviceAccountAuth = new JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID!, serviceAccountAuth);
    await doc.loadInfo();
    const sheet = doc.sheetsByTitle['knowledge'];
    results.googleSheets = {
      success: true,
      title: doc.title,
      hasKnowledgeTab: !!sheet,
      sheets: doc.sheetsByIndex.map(s => s.title)
    };
  } catch (e: any) {
    results.googleSheets = { success: false, error: e.message };
  }

  // 2. Test Supabase
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase env vars");
    }
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    // Check if table exists by trying to select
    const { error } = await supabase.from('documents').select('id').limit(1);
    if (error) throw error;
    results.supabase = { success: true, message: "Connected and table 'documents' exists" };
  } catch (e: any) {
    results.supabase = { success: false, error: e.message };
  }

  // 3. Test Gemini
  try {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("Missing Gemini API Key");
    }
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "text-embedding-004" });
    await model.embedContent("test");
    results.gemini = { success: true, message: "Embedding generated successfully" };
  } catch (e: any) {
    results.gemini = { success: false, error: e.message };
  }

  return Response.json(results, { status: 200 });
}
