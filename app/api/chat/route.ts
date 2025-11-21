import { OpenAI } from 'openai';
import { getAvailability, bookSlot, addSlot, createBatchSchedule } from '@/lib/googleSheets';
import { retrieveContext } from '@/lib/rag';

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();
    const lastMessage = messages[messages.length - 1];
    
    // RAG Step - only for user messages
    let context = "";
    if (lastMessage.role === 'user') {
      context = await retrieveContext(lastMessage.content);
    }
    
    const systemPrompt = `You are a helpful assistant for a Tuition Centre.
    
    STYLE:
    - Keep answers SHORT, CLEAR, and SIMPLE.
    - Use basic, standard English. You understand Singlish, but reply in plain English.
    - Be friendly and direct.

    ROLE:
    - You primarily help STUDENTS check availability and book slots.
    - You can also help ADMINS manage the schedule, BUT only if they provide the admin password.

    RULES:
    1. Always check the Google Sheet using 'getAvailability' before promising a slot.
    2. If a student wants to book, YOU MUST ASK for their Name AND Contact Info (Phone or Email).
    3. Use 'bookSlot' only when you have both Name and Contact Info.
    4. RESTRICTED ACTIONS: 'addSlot' and 'createBatchSchedule' are for ADMINS ONLY.
       - If a user asks to create/add slots or change the schedule, ask them for the admin password.
       - If they don't have it, politely tell them to contact staff for manual changes.
       - NEVER output the admin password yourself.
    
    Today is ${new Date().toISOString()}.
    Always convert relative dates (tomorrow, next week) to specific dates (YYYY-MM-DD).
    
    Knowledge Base Context:
    ${context}
    `;

    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "getAvailability",
          description: "Check available slots for a given date and subject.",
          parameters: {
            type: "object",
            properties: {
              date: { type: "string", description: "Date in YYYY-MM-DD format" },
              subject: { type: "string", description: "Subject (e.g., Math, Science)" },
            },
            required: ["date", "subject"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "bookSlot",
          description: "Book a slot for a student.",
          parameters: {
            type: "object",
            properties: {
              rowId: { type: "number", description: "The row ID of the slot to book" },
              studentName: { type: "string", description: "Name of the student" },
              contactInfo: { type: "string", description: "Student's phone number or email" },
            },
            required: ["rowId", "studentName", "contactInfo"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "addSlot",
          description: "ADMIN ONLY: Add a new slot. Requires admin password.",
          parameters: {
            type: "object",
            properties: {
              adminPassword: { type: "string", description: "The admin password provided by the user" },
              date: { type: "string", description: "Date in YYYY-MM-DD format" },
              time: { type: "string", description: "Time (e.g., 10:00)" },
              subject: { type: "string", description: "Subject (e.g., Math)" },
              teacher: { type: "string", description: "Teacher's name" },
            },
            required: ["adminPassword", "date", "time", "subject", "teacher"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "createBatchSchedule",
          description: "ADMIN ONLY: Create batch slots. Requires admin password.",
          parameters: {
            type: "object",
            properties: {
              adminPassword: { type: "string", description: "The admin password provided by the user" },
              startDate: { type: "string", description: "Start date in YYYY-MM-DD format" },
              days: { type: "number", description: "Number of days to generate for" },
              subject: { type: "string", description: "Subject" },
              teacher: { type: "string", description: "Teacher's name" },
            },
            required: ["adminPassword", "startDate", "days", "subject", "teacher"],
          },
        },
      },
    ];

    // Initial call to DeepSeek
    // We construct the full message history for the API call
    let currentMessages = [
      { role: "system", content: systemPrompt },
      ...messages
    ];

    let response = await deepseek.chat.completions.create({
      model: "deepseek-chat",
      messages: currentMessages as any,
      tools: tools,
    });

    let message = response.choices[0].message;

    // Tool execution loop
    // Limit loop to prevent infinite loops
    let loopCount = 0;
    while (message.tool_calls && loopCount < 5) {
      loopCount++;
      const toolCalls = message.tool_calls;
      
      // Append the assistant's message (with tool calls) to the history
      currentMessages.push(message as any);

      for (const toolCall of toolCalls) {
        // @ts-ignore
        const functionName = toolCall.function.name;
        // @ts-ignore
        const args = JSON.parse(toolCall.function.arguments);
        let result;

        console.log(`Executing tool: ${functionName} with args:`, args);

        try {
          if (functionName === 'getAvailability') {
            result = await getAvailability(args.date, args.subject);
          } else if (functionName === 'bookSlot') {
            result = await bookSlot(args.rowId, args.studentName, args.contactInfo);
          } else if (functionName === 'addSlot') {
            if (args.adminPassword !== process.env.ADMIN_PASSWORD) {
              throw new Error("Invalid admin password. Cannot add slot.");
            }
            result = await addSlot(args.date, args.time, args.subject, args.teacher);
          } else if (functionName === 'createBatchSchedule') {
            if (args.adminPassword !== process.env.ADMIN_PASSWORD) {
              throw new Error("Invalid admin password. Cannot create schedule.");
            }
            result = await createBatchSchedule(args.startDate, args.days, args.subject, args.teacher);
          }
        } catch (error: any) {
          result = { error: error.message };
        }

        // Append tool result to history
        currentMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        } as any);
      }

      // Call DeepSeek again with tool results
      response = await deepseek.chat.completions.create({
        model: "deepseek-chat",
        messages: currentMessages as any,
        tools: tools,
      });

      message = response.choices[0].message;
    }

    return Response.json(message);
  } catch (error: any) {
    console.error("Error in chat route:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
