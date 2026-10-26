export const AFTER_MIDDLEWARE_CASES = [
  {
    pathname: '/ecosystem-regression/after-middleware',
    status: 418,
    body: { source: 'umi-after-middleware', result: 'handled' },
  },
  {
    pathname: '/ecosystem-regression/unmatched-api',
    status: 404,
    body: { source: 'umi-after-middleware', result: 'not-found' },
  },
];

export default function routingRegression(api) {
  // Umi places addMiddlewares after its internal Utoopack asset proxy.
  api.addMiddlewares(() => [
    (req, res, next) => {
      const response = AFTER_MIDDLEWARE_CASES.find(
        ({ pathname }) => pathname === req.url.split('?')[0],
      );
      if (!response) return next();
      return res.status(response.status).json(response.body);
    },
  ]);
}
