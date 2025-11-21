import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
const model = genAI.getGenerativeModel({ model: "text-embedding-004" });

export async function retrieveContext(query: string) {
  try {
    // Generate embedding
    const result = await model.embedContent(query);
    const embedding = result.embedding.values;

    // Query Supabase
    const { data, error } = await supabase.rpc('match_documents', {
      query_embedding: embedding,
      match_threshold: 0.5, // Lowered slightly to ensure we get some results
      match_count: 3,
    });

    if (error) {
      console.error('Error querying Supabase:', error);
      return "";
    }

    if (!data || data.length === 0) {
      return "";
    }

    // Format context
    // Assuming the table has a 'content' column
    return data.map((doc: any) => doc.content).join('\n\n');
  } catch (error) {
    console.error("Error in retrieveContext:", error);
    return "";
  }
}
