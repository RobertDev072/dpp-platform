const express = require("express");
const { requireAuth } = require("../middleware/auth");
const companiesRepo = require("../repositories/companies.repository");
const usersRepo = require("../repositories/users.repository");
const productsRepo = require("../repositories/products.repository");
const plansRepo = require("../repositories/plans.repository");

const router = express.Router();

router.get("/stats", requireAuth, async (req, res, next) => {
  try {
    if (require("../utils/roles").isPlatformOwner(req.user.role)) {
      const [companies, activeCompanies, activeUsers, products] = await Promise.all([
        companiesRepo.countCompanies(),
        companiesRepo.countActiveCompanies(),
        usersRepo.countAllActiveUsers(),
        productsRepo.countProductsByStatus()
      ]);

      res.json({
        scope: "platform",
        companies,
        activeCompanies,
        activeUsers,
        products,
        qrScans: 0,
        pendingInvites: 0
      });
      return;
    }

    const [activeUsers, products, company, maxUsers] = await Promise.all([
      usersRepo.countActiveUsers(req.user.companyId),
      productsRepo.countProductsByStatus({ companyId: req.user.companyId }),
      companiesRepo.getCompanyById(req.user.companyId),
      plansRepo.getMaxUsersForCompany(req.user.companyId)
    ]);

    const plan = company && company.plan_id ? await plansRepo.getPlanById(company.plan_id) : null;

    res.json({
      scope: "company",
      activeUsers,
      products,
      qrScans: 0,
      companyName: company ? company.name : null,
      planName: plan ? plan.name : null,
      maxUsers
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
