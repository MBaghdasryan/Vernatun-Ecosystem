import {notificationCenter} from './notification-center.js';
import {staffAvailability} from './staff-availability.js';
import {unitPlans} from './unit-plans.js';
import {handoverReadiness} from './handover-readiness.js';
import {systemCenter} from './system-center.js';
import {systemUpdateCallbacks} from './system-update-callbacks.js';
import {externalApi} from './system-api.js';
import {systemRequestLog,safeCode} from './system-observability.js';
import {safeDatabaseFailure} from './system-diagnostics.js';
import {branding} from './branding.js';
import {portfolioObjects} from './portfolio-objects.js';
import {platformFoundation} from './platform-foundation.js';
import {insights} from './insights.js';
import {workspaceSearch} from './workspace-search.js';
import {implementationTools} from './implementation-tools.js';
import {platformSupportMeetings} from './platform-support-meetings.js';
import {hayat} from './hayat.js';
import {reporting} from './reporting.js';
import {lifecycle} from './lifecycle.js';
import {documents} from './documents.js';
import {documentVersions} from './document-versions.js';
import {ownership} from './ownership.js';
import {governance} from './governance.js';
import {portfolioAnalytics} from './portfolio-analytics.js';
import {services} from './services.js';
import {maintenance} from './maintenance.js';
import {residentLifecycle} from './resident-lifecycle.js';
import {residentWorkspace,residentContexts} from './resident-workspace.js';
import {residentRecords} from './resident-records.js';
import {residentListingPhotos} from './resident-listing-photos.js';
import {residentConversations} from './resident-conversations.js';
import {residentContinuity} from './resident-continuity.js';
import {residentDirectChat} from './resident-direct-chat.js';
import {residentBookings} from './resident-bookings.js';
import {residentFinanceTransparency} from './resident-finance-transparency.js';
import {residentAvatar} from './resident-avatar.js';
import {residentHousehold} from './resident-household.js';
import {residentPayerResponsibility} from './resident-payer-responsibility.js';
import {notificationLinks} from './notification-links.js';
import {imports} from './imports.js';
import {mfa} from './mfa.js';
import {finance} from './finance.js';
import {payments} from './payments/routes.js';
import {billingBatches} from './billing-batches.js';
import {bankReconciliation} from './bank-reconciliation.js';
import {organizationConsole} from './organization-console.js';
import {supportConversation} from './support-conversation.js';
import {onboardingWorkflow} from './onboarding-workflow.js';
import {typedImports} from './typed-imports.js';
import {field} from './field.js';
import {grants} from './grants.js';
import {photos} from './photos.js';
import {workflow} from './workflow.js';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import {sessionRevocationGuard} from './system-sessions.js';
import pgSession from 'connect-pg-simple';
import passport from 'passport';
import helmet from 'helmet';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {ZodError} from 'zod';
import {config} from './config.js';
import {pool} from './db.js';
import {ApiError} from './access.js';
import {auth} from './auth.js';
import {api} from './api.js';
import {logger} from '../../../src/lib/logger.js';
import {emailWebhooks} from './email-delivery-events.js';
import {emailOperations} from './email-operations.js';
import {coreOperations} from './core-operations.js';
import {operationIncidents} from './operation-incidents.js';
import {mfaPolicy} from './mfa-policy.js';
import {leads} from './leads.js';
import {pagedRecords} from './paged-records.js';
import {edgeMachineApi} from './edge-machine-api.js';
import {edgeMachineApiV2} from './edge-machine-api-v2.js';
import {edgeManagementApi} from './edge-management-api.js';
import {ownerRegistrationAdmin} from './owner-registration.js';
export const app=express();app.set('trust proxy',1);app.disable('x-powered-by');app.use(helmet());
app.use('/api',cors({
 origin(origin,callback){callback(null,origin===config.APP_ORIGIN?origin:false)},
 credentials:true,
}));
app.use('/api',systemRequestLog);
// No provider callback is accepted without its contracted verification scheme.
// These fail-closed endpoints are intentionally before session/CSRF middleware.
app.post(['/api/payments/callbacks/ameriabank','/api/payments/callbacks/arca','/api/utilities/callbacks/telcell'],
 (_req,res)=>{res.status(409).json({error:'provider_contract_required'})});
// Only this signed, raw-body endpoint bypasses session CSRF.
app.use('/api/webhooks',emailWebhooks);
// Backward-compatible route for already registered legacy hooks. The canonical
// documented URL is /api/webhooks/resend; both routes use identical verification.
app.use('/api/email-webhooks',emailWebhooks);
// Statement rows are structured metadata, not file bytes. Keep the larger
// bounded parser confined to statement preview/import, with the same auth/CSRF.
app.use('/api/finance/bank/imports',express.json({limit:'1mb'}));
app.use('/api/platform/imports',express.json({limit:'1mb'}));
app.use('/api/edge/v1',express.json({limit:'2mb'}));
app.use('/api/edge/v2',express.json({limit:'2mb'}));
app.use(express.json({limit:'32kb'}));
app.use('/api/edge/v1',edgeMachineApi);
app.use('/api/edge/v2',edgeMachineApiV2);
app.use(session({name:'vernatun.sid',secret:config.SESSION_SECRET,store:new (pgSession(session))({pool,tableName:'session'}),resave:false,saveUninitialized:false,cookie:{httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'lax',maxAge:8*60*60*1000}}));
app.use(sessionRevocationGuard);
app.use(passport.initialize());app.use(passport.session());
app.use('/api',(req,_res,next)=>{
 if(!req.user?.mustChangePassword)return next();
 const path=req.path.replace(/\/+$/,'')||'/';
 const allowed=(req.method==='GET'&&(path==='/auth/session'||path==='/health'))||
  (req.method==='POST'&&(path==='/auth/first-login-password'||path==='/auth/logout'));
 if(allowed)return next();
 next(new ApiError(403,'password_change_required'));
});
// Update callbacks authenticate with a per-release bearer token, not a browser session.
// Keep the exception path-scoped; all other mutating API routes retain CSRF protection.
app.use('/api/system/updates',systemUpdateCallbacks);
app.use('/api',(req,res,next)=>{res.setHeader('Cache-Control','no-store');if(['GET','HEAD','OPTIONS'].includes(req.method))return next();const origin=req.headers.origin;if(origin&&origin!==config.APP_ORIGIN)return next(new ApiError(403,'csrf_invalid'));const expected=req.session.csrf;const actual=req.get('X-CSRF-Token');if(!expected||!actual||Buffer.byteLength(actual)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(actual),Buffer.from(expected)))return next(new ApiError(403,'csrf_invalid'));next()});
app.use('/api',edgeManagementApi);
app.use('/api',ownerRegistrationAdmin);
app.get('/api/health',async(_req,res)=>{await pool.query('SELECT 1');res.json({status:'ok',stage:1})});
app.use('/api/auth',auth);app.use('/api/mfa',mfaPolicy);app.use('/api/mfa',mfa);
app.use('/api/me',residentContexts);
app.use('/api/resident',residentWorkspace,residentRecords,residentConversations,residentContinuity,residentDirectChat,residentBookings,residentFinanceTransparency,residentAvatar,residentHousehold,residentListingPhotos,residentPayerResponsibility);
app.use('/api',leads);
// External v1 uses scoped API keys instead of browser sessions. Mount it before
// routers with router-wide requireAuth middleware so those guards cannot consume
// /api/v1/* requests before externalApi validates its bearer key.
app.use('/api/v1',externalApi);
app.use('/api',staffAvailability);
app.use('/api',payments);
app.use('/api',unitPlans);
app.use('/api',handoverReadiness);
app.use('/api',systemCenter);
app.use('/api',pagedRecords);
app.use('/api',documentVersions);app.use('/api',ownership);app.use('/api',governance);app.use('/api',portfolioAnalytics);
app.use('/api',notificationCenter);app.use('/api',branding);app.use('/api',portfolioObjects);
app.use('/api',platformFoundation);app.use('/api',coreOperations);app.use('/api',operationIncidents);app.use('/api',photos);app.use('/api',workflow);app.use('/api',finance);app.use('/api',field);app.use('/api',residentLifecycle);app.use('/api',notificationLinks);app.use('/api',grants);app.use('/api',maintenance);app.use('/api',services);app.use('/api',imports);app.use('/api',lifecycle);app.use('/api',documents);app.use('/api',reporting);app.use('/api',insights);app.use('/api',api);
app.use('/api',hayat);
app.use('/api',billingBatches);
app.use('/api',bankReconciliation);
app.use('/api',organizationConsole);
app.use('/api',supportConversation);
app.use('/api',onboardingWorkflow);
app.use('/api',typedImports);
app.use('/api',workspaceSearch);
app.use('/api',implementationTools);
app.use('/api',platformSupportMeetings);
app.use('/api',emailOperations);
app.use('/api',(_req,res)=>res.status(404).json({error:'not_found'}));
app.use((error:unknown,_req:express.Request,res:express.Response,next:express.NextFunction)=>{res.locals.systemException=error;res.locals.systemErrorCode=safeCode(error instanceof ApiError?error.code:error instanceof ZodError?'validation_error':(error as {code?:unknown})?.code);next(error)});
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{if((error as {type?:string})?.type==='entity.too.large')return res.status(413).json({error:'file_too_large'});if(error instanceof ApiError)return res.status(error.status).json({error:error.code});if(error instanceof ZodError)return res.status(400).json({error:'validation_error',fields:Object.fromEntries(error.issues.map(i=>[i.path.join('.'),i.code]))});if((error as {code?:string})?.code==='23505')return res.status(409).json({error:'already_exists'});if((error as {code?:string})?.code==='23503')return res.status(400).json({error:'invalid_reference'});const incident=randomBytes(6).toString('hex');const code=(error as {code?:string})?.code??'unknown';logger.error({incident,code,...(safeDatabaseFailure(error)??{})},'Vernatun API error');if(['ECONNREFUSED','ETIMEDOUT','ENOTFOUND','57P01','53300','42P01','42703'].includes(code))return res.status(503).json({error:'service_unavailable',incident});return res.status(500).json({error:'server_error',incident})});
