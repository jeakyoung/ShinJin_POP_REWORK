package com.shinjin.pop.shipping;

import com.shinjin.pop.output.DemoReportPrinter.Delivery;
import java.util.Map;

/** Fixed synthetic customer assignments for the seeded packing plans. */
final class ShippingCustomerFixture {
    private static final Map<String, Delivery> CUSTOMERS = Map.of(
            "DEMO-C1", Delivery.PAPER, "DEMO-C2", Delivery.EMAIL, "DEMO-C3", Delivery.PAPER_AND_EMAIL);
    private static final Map<String, String> PLAN_CUSTOMER = Map.ofEntries(
            Map.entry("F1/000001/20261125/1", "DEMO-C1"), Map.entry("F1/000001/20261125/2", "DEMO-C2"),
            Map.entry("F1/000001/20261125/3", "DEMO-C3"), Map.entry("F1/000001/20261125/4", "DEMO-C3"),
            Map.entry("F1/000001/20261125/5", "DEMO-C1"), Map.entry("F1/000001/20261125/6", "DEMO-C2"),
            Map.entry("F1/000001/20261125/7", "DEMO-C3"), Map.entry("F1/000001/20261125/8", "DEMO-C1"),
            Map.entry("F1/000001/20261125/9", "DEMO-C1"), Map.entry("F1/000001/20261125/10", "DEMO-C2"),
            Map.entry("F1/000001/20261125/11", "DEMO-C3"), Map.entry("F1/000001/20261125/12", "DEMO-C1"),
            Map.entry("F1/000001/20261125/13", "DEMO-C2"), Map.entry("F2/000002/20261125/1", "DEMO-C3"));

    static Delivery delivery(String packingRef) {
        String customer = PLAN_CUSTOMER.get(packingRef);
        return customer == null ? null : CUSTOMERS.get(customer);
    }

    static Delivery deliveryForCustomer(String code) {
        return CUSTOMERS.get(code);
    }

    private ShippingCustomerFixture() {}
}
