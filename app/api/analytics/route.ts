import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Count messages handled
    const { count: messagesCount, error: messagesError } = await supabase
      .from('analytics')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'message_handled')
      .gte('created_at', sevenDaysAgo.toISOString());

    if (messagesError) throw messagesError;

    // Count contact requests
    const { count: contactsCount, error: contactsError } = await supabase
      .from('analytics')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'contact_request')
      .gte('created_at', sevenDaysAgo.toISOString());

    if (contactsError) throw contactsError;

    // Count bookings
    const { count: bookingsCount, error: bookingsError } = await supabase
      .from('analytics')
      .select('*', { count: 'exact', head: true })
      .eq('event_type', 'booking_made')
      .gte('created_at', sevenDaysAgo.toISOString());

    if (bookingsError) throw bookingsError;

    return Response.json({
      messages_handled: messagesCount ?? 0,
      contact_requests: contactsCount ?? 0,
      bookings_made: bookingsCount ?? 0,
      period: 'Last 7 days',
    });
  } catch (error) {
    console.error('Analytics error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}

// Log analytics event
export async function POST(req: Request) {
  try {
    const { event_type, metadata } = await req.json();

    if (!event_type) {
      return Response.json({ error: 'event_type is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('analytics')
      .insert({ event_type, metadata: metadata || {} });

    if (error) throw error;

    return Response.json({ success: true });
  } catch (error) {
    console.error('Analytics logging error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return Response.json({ error: message }, { status: 500 });
  }
}
