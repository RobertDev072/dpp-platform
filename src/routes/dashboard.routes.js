const express = require("express");
const { requireAuth } = require("../middleware/auth");
const companiesRepo = require("../repositories/companies.repository");
const usersRepo = require("../repositories/users.repository");
const productsRepo = require("../repositories/products.repository");

const router = express.Router();

router.get("/stats", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === "system_owner") {
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

    const [activeUsers, products] = await Promise.all([
      usersRepo.countActiveUsers(req.user.companyId),
      productsRepo.countProductsByStatus({ companyId: req.user.companyId })
    ]);

    res.json({
      scope: "company",
      activeUsers,
      products,
      qrScans: 0
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
