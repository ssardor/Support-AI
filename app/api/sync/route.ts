import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getKnowledgeBase, KnowledgeBaseEntry } from '@/lib/googleSheets';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

export async function GET() {
  try {
    // 1. Get data from Google Sheets
  const knowledge: KnowledgeBaseEntry[] = await getKnowledgeBase();
    
    if (knowledge.length === 0) {
      return Response.json({ message: "No knowledge found in Google Sheets." });
    }

    // 2. Clear existing data (optional, for MVP simplicity we replace everything)
    const { error: deleteError } = await supabase
      .from('documents')
      .delete()
      .neq('id', 0); // Delete all rows

    if (deleteError) {
      console.error("Error clearing Supabase:", deleteError);
    }

    // 3. Generate embeddings and insert
    let count = 0;
  for (const item of knowledge) {
      if (!item.question || !item.answer) continue;

  const content = `Q: ${item.question}\nA: ${item.answer}`;
      
      // Generate embedding
  const result = await model.embedContent(content);
  const embedding = result.embedding?.values ?? [];

      // Insert into Supabase
      const { error } = await supabase.from('documents').insert({
        content,
        embedding,
        metadata: { question: item.question },
      });

      if (error) {
        console.error("Error inserting document:", error);
      } else {
        count++;
      }
    }

    return Response.json({ 
      message: `Successfully synced ${count} items from Google Sheets to Supabase.` 
    });

  } catch (error) {
    console.error("Sync error:", error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
