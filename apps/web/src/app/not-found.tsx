export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
      <h1 className="text-display">404</h1>
      <p className="text-text-muted text-center text-lg">Page not found</p>
      <a href="/" className="text-accent hover:underline">
        Return home
      </a>
    </div>
  );
}
