import { SetMetadata } from '@nestjs/common';

export const STRONG_AUTH_KEY = 'strongAuth';
export const StrongAuth = () => SetMetadata(STRONG_AUTH_KEY, true);
