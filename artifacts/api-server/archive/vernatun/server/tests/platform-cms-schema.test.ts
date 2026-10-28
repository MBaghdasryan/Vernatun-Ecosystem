import test from 'node:test';
import assert from 'node:assert/strict';
import {cmsBrandSchema,cmsPageContentSchema,cmsSlugSchema} from '../platform-cms-schema.js';

const content=()=>Object.fromEntries(['hy','ru','en'].map(locale=>[locale,{
 title:`Title ${locale}`,summary:`Summary ${locale}`,body:`Body ${locale}`,
}]));

test('platform brand accepts bounded colors and HTTPS logo only',()=>{
 const valid={brandName:'Vernatun',primaryColor:'#0b2230',accentColor:'#ff6b0a',logoUrl:'https://static.vernatun.io/logo.png'};
 assert.equal(cmsBrandSchema.safeParse(valid).success,true);
 for(const logoUrl of ['http://static.vernatun.io/logo.png','https://user:pass@static.vernatun.io/logo.png','javascript:alert(1)']){
  assert.equal(cmsBrandSchema.safeParse({...valid,logoUrl}).success,false);
 }
 assert.equal(cmsBrandSchema.safeParse({...valid,primaryColor:'orange'}).success,false);
});

test('CMS pages require all three localized entries and bounded titles',()=>{
 assert.equal(cmsPageContentSchema.safeParse(content()).success,true);
 assert.equal(cmsPageContentSchema.safeParse({hy:content().hy,ru:content().ru}).success,false);
 assert.equal(cmsPageContentSchema.safeParse({...content(),en:{title:'',summary:'',body:''}}).success,false);
});

test('CMS route slugs cannot contain paths or markup',()=>{
 for(const slug of ['privacy','privacy-policy-2'])assert.equal(cmsSlugSchema.safeParse(slug).success,true);
 for(const slug of ['../privacy','privacy/terms','<script>'])assert.equal(cmsSlugSchema.safeParse(slug).success,false);
});
