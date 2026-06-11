import axios from 'axios';
import { API_BASE_URL } from '../config';
import { getAuthBlockMessageFromError } from '../utils/licenseGuard';

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = token;
  return config;
});

export default api;


api.interceptors.response.use(
  (res) => res,
  (err) => {
    const blockMsg = getAuthBlockMessageFromError(err);
    if (blockMsg) {
      localStorage.removeItem('token');
      localStorage.removeItem('_id');
      localStorage.setItem('movyo_login_notice', blockMsg);
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);
