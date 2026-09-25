import './next.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../styles.css';
import '../organization.css';
import '../volunteer-table.css';
import '../owner-status.css';
import '../dashboard.css';
import '../brand.css';
import './modern.css';
import './mobile.css';

export const metadata = {
  icons: { icon: '/assets/logo-gaubretrail.svg' },
  title: 'Gaubre’Trail · Organisation & bénévoles',
  description: 'Carte des parcours et espace de gestion du Gaubre’Trail.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#333399',
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr">
      <body className="portal-view" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
