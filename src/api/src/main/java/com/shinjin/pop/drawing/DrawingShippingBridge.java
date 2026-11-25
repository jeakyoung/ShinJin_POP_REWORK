package com.shinjin.pop.drawing;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import synthetic.drawing.DrawingDomain;
import synthetic.drawing.DrawingDomain.Session;
import synthetic.drawing.DrawingDomain.State;
import synthetic.shipping.ShippingDomain;

import java.util.ArrayList;
import java.util.List;

@Component
@Profile("demo")
public final class DrawingShippingBridge {
    public record Feed(ShippingDomain.Actor actor, List<ShippingDomain.Handoff> handoffs) {
        public Feed { handoffs = List.copyOf(handoffs); }
    }

    private final DrawingDomain drawing;

    public DrawingShippingBridge(DrawingDomain drawing) {
        this.drawing = drawing;
    }

    public ShippingDomain.Actor actor(HttpServletRequest request) {
        return actor(DrawingController.session(request));
    }

    private static ShippingDomain.Actor actor(Session session) {
        return new ShippingDomain.Actor(new ShippingDomain.Scope(session.factory(), session.site()),
                session.terminal(), session.operator());
    }

    public Feed read(HttpServletRequest request) {
        var session = DrawingController.session(request);
        var actor = actor(session);
        var scope = actor.scope();
        String terminal = switch (actor.terminal()) {
            case "DEMO-A", "DEMO-A2" -> "DEMO-A";
            case "DEMO-B" -> "DEMO-B";
            default -> throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Shipping terminal unavailable");
        };
        List<ShippingDomain.Handoff> found = new ArrayList<>();
        for (var key : DrawingController.scopedPlanKeys(session)) {
            var result = drawing.get(session, key);
            if (result.status() != 200) {
                throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Packing handoff unavailable");
            }
            var snapshot = result.value();
            var shipment = snapshot.shipment();
            if (snapshot.state() == State.SHIP_READY && shipment != null) {
                var stock = shipment.stock();
                found.add(new ShippingDomain.Handoff(shipment.id(), DrawingController.format(key), scope, terminal,
                        stock.lot(), stock.item(), shipment.quantity(), shipment.deferred()));
            }
        }
        return new Feed(actor, found);
    }
}
