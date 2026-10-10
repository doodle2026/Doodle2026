import { jsonError } from '@/lib/http';

const notFound = () => jsonError(404, ['Ikke fundet.']);
export { notFound as GET, notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE };
