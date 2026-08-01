import { API_URL } from './auth.js';

function authHeaders(token) {
  return { authorization: `Bearer ${token}` };
}

export async function fetchFriends(token) {
  const response = await fetch(`${API_URL}/api/friends`, { headers: authHeaders(token) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? 'No se pudo cargar la lista de amigos');
  return data; // { friends, incoming, outgoing }
}

export async function sendFriendRequest(token, username) {
  const response = await fetch(`${API_URL}/api/friends/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ username }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? 'No se pudo enviar la solicitud');
  return data;
}

export async function respondFriendRequest(token, requestId, accept) {
  const response = await fetch(`${API_URL}/api/friends/${requestId}/respond`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ accept }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? 'No se pudo responder la solicitud');
  return data;
}

export async function removeFriendship(token, requestId) {
  const response = await fetch(`${API_URL}/api/friends/${requestId}/remove`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? 'No se pudo eliminar');
  return data;
}
