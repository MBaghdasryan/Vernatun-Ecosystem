import ts from 'typescript';

const methods=new Set(['get','post','put','patch','delete','head','options']);
const parse=(name,text)=>ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true);
function strings(node,bindings){
 if(!node)return null;
 if(ts.isParenthesizedExpression(node)||ts.isAsExpression(node)||ts.isNonNullExpression(node))return strings(node.expression,bindings);
 if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return [node.text];
 if(ts.isIdentifier(node))return bindings.get(node.text)??null;
 if(ts.isArrayLiteralExpression(node)){
  const values=node.elements.map(e=>strings(e,bindings));
  return values.every(Boolean)?values.flat():null;
 }
 if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken){
  const a=strings(node.left,bindings),b=strings(node.right,bindings);
  return a&&b?a.flatMap(x=>b.map(y=>x+y)):null;
 }
 if(ts.isTemplateExpression(node)){
  let values=[node.head.text];
  for(const span of node.templateSpans){
   const next=strings(span.expression,bindings);if(!next)return null;
   values=values.flatMap(a=>next.map(b=>a+b+span.literal.text));
  }
  return values;
 }
 return null;
}

/** Static evidence only: resolve mounted imports and literal loop paths.
 * Never turn the literal prefix of an unresolved expression into a real route.
 */
export function inventoryMountedRoutes(appText,sources){
 const app=parse('app.ts',appText),imports=new Map(),mounts=[],routes=new Map(),unresolved=[];
 for(const s of app.statements){
  if(!ts.isImportDeclaration(s)||!ts.isStringLiteral(s.moduleSpecifier))continue;
  const file=s.moduleSpecifier.text.split('/').pop().replace(/\.js$/,'.ts');
  const clause=s.importClause;
  if(clause?.name)imports.set(clause.name.text,{file,symbol:'default'});
  if(clause?.namedBindings&&ts.isNamedImports(clause.namedBindings)){
   for(const item of clause.namedBindings.elements)imports.set(item.name.text,{file,symbol:(item.propertyName??item.name).text});
  }
 }
 function add(prefix,path,source,node){
  const full=(prefix+path).replace(/\/+/g,'/');
  if(full!=='/api'&&!full.startsWith('/api/'))return;
  const normalized=(full.slice(4)||'/').replace(/\/$/,'')||'/';
  const method=node.expression.name.text.toUpperCase();
  const key=method+' '+normalized.replace(/:([A-Za-z_]\w*)/g,'{$1}');
  const current=routes.get(key)??{key,sources:[]};
  if(!current.sources.includes(source))current.sources.push(source);
  routes.set(key,current);
 }
 function appVisit(node){
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(app)==='app'){
   const method=node.expression.name.text,path=strings(node.arguments[0],new Map());
   if(method==='use'&&path){
    for(const arg of node.arguments.slice(1)){
     if(ts.isIdentifier(arg)&&imports.has(arg.text))for(const prefix of path)mounts.push({...imports.get(arg.text),prefix});
    }
   }else if(methods.has(method)&&path)for(const p of path)add('',p,'app.ts',node);
  }
  ts.forEachChild(node,appVisit);
 }
 appVisit(app);
 for(const mount of mounts){
  const text=sources.get(mount.file);
  if(text===undefined){unresolved.push({source:mount.file,expression:'Missing mounted source: '+mount.symbol});continue}
  const file=parse(mount.file,text);
  let symbol=mount.symbol;
  for(const statement of file.statements){
   if(ts.isExportAssignment(statement)&&symbol==='default'&&ts.isIdentifier(statement.expression))symbol=statement.expression.text;
   if(ts.isExportDeclaration(statement)&&statement.exportClause&&ts.isNamedExports(statement.exportClause)){
    const alias=statement.exportClause.elements.find(e=>e.name.text===symbol);if(alias)symbol=(alias.propertyName??alias.name).text;
   }
  }
  function visit(node,bindings){
   if(ts.isForOfStatement(node)){
    const values=strings(node.expression,bindings);
    const declaration=ts.isVariableDeclarationList(node.initializer)?node.initializer.declarations[0]:null;
    if(values&&declaration&&ts.isIdentifier(declaration.name)){
     for(const value of values){const scoped=new Map(bindings);scoped.set(declaration.name.text,[value]);visit(node.statement,scoped)}
     return;
    }
   }
   if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)){
    const values=strings(node.initializer,bindings);if(values)bindings.set(node.name.text,values);
   }
   if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text===symbol&&methods.has(node.expression.name.text)){
    const paths=strings(node.arguments[0],bindings);
    if(paths)for(const path of paths)add(mount.prefix,path,mount.file,node);
    else unresolved.push({source:mount.file,line:file.getLineAndCharacterOfPosition(node.getStart(file)).line+1,expression:node.arguments[0]?.getText(file)??'(missing path)'});
    // Handler internals are not router registration statements.
    return;
   }
   ts.forEachChild(node,child=>visit(child,bindings));
  }
  visit(file,new Map());
 }
 return {routes:[...routes.values()].sort((a,b)=>a.key.localeCompare(b.key)),unresolved};
}
