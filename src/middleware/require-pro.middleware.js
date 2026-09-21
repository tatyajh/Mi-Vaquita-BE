import BillingService from '../services/billing.service.js';

const billingService = BillingService;

// Se monta después de authenticateJWT (necesita req.userId). Gatea
// funciones Pro (exportar, recordatorios) sin duplicar la lógica de
// qué cuenta como "activo" — eso vive en billing.service.js.
export const requirePro = async (req, res, next) => {
  try {
    const isPro = await billingService.isUserPro(req.userId);
    if (!isPro) {
      return res.status(403).json({ message: 'Esta función es exclusiva de Mi Vaquita Pro', code: 'PRO_REQUIRED' });
    }
    next();
  } catch (error) {
    console.error('Failed to check Pro status:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

export default requirePro;
