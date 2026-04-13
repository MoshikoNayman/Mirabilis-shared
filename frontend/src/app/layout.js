import './globals.css';

export const metadata = {
  title: 'Mirabilis AI',
  description: 'Local ChatGPT-style app with Ollama streaming'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply saved font + color scheme before hydration to prevent flash */}
        <script dangerouslySetInnerHTML={{ __html: `try{var f=localStorage.getItem('mirabilis-font');if(f)document.documentElement.setAttribute('data-font',f);var cs=localStorage.getItem('mirabilis-color-scheme');if(cs&&['dusk','ember','summit'].includes(cs))document.documentElement.setAttribute('data-color-scheme',cs);}catch(e){}` }} />
      </head>
      <body
        suppressHydrationWarning
        style={{
          '--font-ui': "'Plus Jakarta Sans','Avenir Next','Segoe UI',sans-serif",
          '--font-mono': "'JetBrains Mono',ui-monospace,'SFMono-Regular',Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace"
        }}
      >
        {children}
      </body>
    </html>
  );
}
