package com.shinjin.pop.admin;

import com.shinjin.pop.history.WorkHistoryFixtures.Station;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/** A browser's saved terminal choices are copied only after successful employee authentication. */
public final class PreloginSessionValues {
    private PreloginSessionValues() {}
    private record Pinned(Map<Integer,String> slots,List<String> materials,Map<String,List<String>> warehouses) {}
    private static final String KEY = PreloginSessionValues.class.getName();

    public static void pin(Map<Integer,String> slots,List<String> materials,Map<String,List<String>> warehouses,
                           HttpServletRequest request) {
        var session = request.getSession(false);
        if (session==null) throw new IllegalStateException("Authentication session required");
        Map<String,List<String>> roles=null;
        if (warehouses!=null) {
            var copy=new LinkedHashMap<String,List<String>>();
            warehouses.forEach((role,rows)->copy.put(role,List.copyOf(rows)));
            roles=Map.copyOf(copy);
        }
        session.setAttribute(KEY,new Pinned(slots==null?null:Map.copyOf(slots),materials==null?null:List.copyOf(materials),roles));
    }

    private static Pinned read(HttpServletRequest request) {
        var session=request.getSession(false);
        return session!=null && session.getAttribute(KEY) instanceof Pinned pin ? pin : null;
    }
    static void refreshProcesses(Map<Integer,String> codes,HttpServletRequest request) {
        var old=read(request);
        if(old!=null) pin(codes,List.of(),old.warehouses(),request);
    }

    public static Station applyStation(Station station,HttpServletRequest request) {
        var pin=read(request);
        if (station==null || pin==null || pin.slots()==null) return station;
        var active=pin.slots().entrySet().stream().filter(e->!e.getValue().isBlank()).map(Map.Entry::getKey).sorted().toList();
        return new Station(station.profile(),station.center(),active,station.stages(),station.inputLot(),station.inputQty());
    }
    public static TerminalSettingsDemoController.Values applyMaterials(TerminalSettingsDemoController.Values base,HttpServletRequest request) {
        var pin=read(request);
        return pin==null || pin.materials()==null ? base : new TerminalSettingsDemoController.Values(
                base.process(),base.warehouse(),base.outputs(),pin.materials());
    }
    public static Optional<Map<String,List<String>>> warehouseRoles(HttpServletRequest request) {
        var pin=read(request);
        return pin==null ? Optional.empty() : Optional.ofNullable(pin.warehouses());
    }
}
