const mockLegacyScript=document.createElement("script");mockLegacyScript.src=new URL("./v1/app.js",document.currentScript.src).href;document.head.append(mockLegacyScript);
