import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const spec=JSON.parse(await readFile(new URL('../openapi.json',import.meta.url),'utf8'));
type OperationOptions={
 requestSchema?:string;
 requestMediaType?:string;
 responseStatus?:string;
 responseSchema?:string;
 responseMediaType?:string;
};

function resolveRef(ref:string){
 assert.ok(ref.startsWith('#/'),'Contract schema references must be local');
 return ref.slice(2).split('/').map(part=>part.replace(/~1/g,'/').replace(/~0/g,'~'))
  .reduce((value:any,key:string)=>value?.[key],spec);
}

export function assertOpenApiOperation(path:string,method:string,options:OperationOptions={}){
 const operation=spec.paths[path]?.[method];
 assert.ok(operation,`OpenAPI operation is missing: ${method.toUpperCase()} ${path}`);
 if(options.requestMediaType){
  assert.ok(operation.requestBody?.content?.[options.requestMediaType],
   `${method.toUpperCase()} ${path} is missing ${options.requestMediaType} request schema`);
 }
 if(options.requestSchema){
  const bodySchema=operation.requestBody?.content?.['application/json']?.schema;
  assert.equal(bodySchema?.$ref,`#/components/schemas/${options.requestSchema}`,
   `${method.toUpperCase()} ${path} request body schema drifted`);
 }
 if(options.responseStatus){
  const response=operation.responses?.[options.responseStatus];
  assert.ok(response,`${method.toUpperCase()} ${path} is missing ${options.responseStatus}`);
  const mediaType=options.responseMediaType??'application/json';
  assert.ok(response.content?.[mediaType],
   `${method.toUpperCase()} ${path} ${options.responseStatus} is missing ${mediaType} response schema`);
  if(options.responseSchema){
   const responseSchema=response.content?.[mediaType]?.schema;
   assert.equal(responseSchema?.$ref,`#/components/schemas/${options.responseSchema}`,
    `${method.toUpperCase()} ${path} ${options.responseStatus} schema drifted`);
  }
 }
 return operation;
}

export function assertOpenApiCapabilityStatus(){
 const status=spec.info?.['x-capability-status'];
 assert.ok(status,'Unverified integration scope must be marked in the OpenAPI document');
 assert.match(status.estimates,/unverified/i);
 assert.match(status.parkingPermits,/unverified/i);
 assert.match(status.physicalEdgeIntegrations,/unverified/i);
 assert.equal(spec.paths['/estimates'],undefined,'Do not publish an unconfirmed estimate endpoint');
 assert.equal(spec.paths['/parking-permits'],undefined,'Do not publish an unconfirmed parking permit endpoint');
}

export function openApiSpec(){return spec}
