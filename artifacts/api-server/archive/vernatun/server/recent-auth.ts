import type {Request} from 'express';
import {ApiError} from './access.js';
export function requireRecentAuthentication(req:Request){
 const time=Date.parse(req.session.createdAt??'');
 if(!Number.isFinite(time)||Date.now()-time>5*60*1000)throw new ApiError(403,'recent_authentication_required');
}
