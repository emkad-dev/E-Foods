import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

const authClient = createClient(supabaseUrl, supabaseAnonKey);

export const getBearerToken = (request: Request) => {
  const authHeader = request.headers.get('authorization');

  if (!authHeader) {
    throw new Error('Missing authorization header');
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new Error("Authorization header must be 'Bearer <token>'");
  }

  return token;
};

export const verifySupabaseJwt = async (request: Request) => {
  const token = getBearerToken(request);
  const { data, error } = await authClient.auth.getClaims(token);

  if (error || !data?.claims?.sub) {
    throw new Error(error?.message ?? 'Invalid JWT');
  }

  return {
    claims: data.claims,
    token,
  };
};
