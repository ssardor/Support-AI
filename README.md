# Support AI MVP

This is a Tuition Centre Support AI MVP built with Next.js, DeepSeek, Supabase, and Google Sheets.

## Getting Started

1.  **Environment Variables**:
    Copy `.env.local` and fill in the values:
    - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: Your Google Service Account Email.
    - `GOOGLE_PRIVATE_KEY`: Your Google Service Account Private Key.
    - `GOOGLE_SHEET_ID`: The ID of your Google Sheet.
    - `SUPABASE_URL`: Your Supabase Project URL.
    - `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase Service Role Key.
    - `GEMINI_API_KEY`: Your Google Gemini API Key (for embeddings).
    - `DEEPSEEK_API_KEY`: Your DeepSeek API Key.

2.  **Google Sheets Setup**:
    - Create a Google Sheet.
    - Share it with the Service Account Email.
    - Create a tab named "Schedule" with columns: `Date`, `Time`, `Subject`, `Teacher`, `Student_Name`.
    - Create a tab named "Knowledge" with columns: `Question`, `Answer`.

3.  **Supabase Setup**:
    - Create a project.
    - Enable `pgvector` extension.
    - Create a table for documents and a function `match_documents`.

4.  **Run the Development Server**:

    ```bash
    npm run dev
    ```

    Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Features

- **Chat Widget**: Floating chat widget for students.
- **AI Logic**: DeepSeek V3 for understanding intent and Singlish persona.
- **RAG**: Supabase for knowledge base retrieval.
- **Tools**: Google Sheets integration for checking availability and booking slots.